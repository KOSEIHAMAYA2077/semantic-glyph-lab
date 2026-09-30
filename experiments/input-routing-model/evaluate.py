"""One-pass artificial shape-intent evaluation; no server, input capture or training."""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import resource
import socket
import time

from schema import SchemaError, context, parse, score, transition

ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = Path(__file__).resolve().parent
MODEL_PATH = ROOT / ".local/input-routing-qwen14-model"
MODEL_ID = "Qwen/Qwen3-14B-MLX-4bit"
REVISION = "ba63a5141812f9870287df53341123a71ba41433"
WEIGHT_SHA256 = {
    "model-00001-of-00002.safetensors": "f2f502ca7604ad6789b124bf9cd7a192fda5a60e6f52b1fe521c3aa4dad598ce",
    "model-00002-of-00002.safetensors": "d3758e05e08bcfb5fcd1b76d74758366355c80464398702051ce0388045e898e",
}
MANIFEST = DIRECTORY / "model-manifest.json"
EXPECTED_FILES = {"LICENSE", "README.md", "config.json", "merges.txt", "model.safetensors.index.json",
                  "tokenizer.json", "tokenizer_config.json", "vocab.json", *WEIGHT_SHA256}


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024*1024):
            digest.update(chunk)
    return digest.hexdigest()


def verify_model():
    manifest = json.loads(MANIFEST.read_text())
    if (manifest.get("model"), manifest.get("revision"), manifest.get("license")) != (MODEL_ID, REVISION, "apache-2.0"):
        raise RuntimeError("Unexpected official model identity")
    entries = manifest["files"]
    if len(entries) != len(EXPECTED_FILES) or {item["name"] for item in entries} != EXPECTED_FILES:
        raise RuntimeError("Unexpected model files")
    for entry in entries:
        path = MODEL_PATH/entry["name"]
        digest = sha256(path)
        if path.stat().st_size != entry["bytes"] or digest != entry["sha256"]:
            raise RuntimeError("Model size or SHA256 mismatch")
        if entry["name"] in WEIGHT_SHA256 and digest != WEIGHT_SHA256[entry["name"]]:
            raise RuntimeError("Official weight SHA256 mismatch")
    for name in ("config.json", "tokenizer_config.json"):
        if "auto_map" in json.loads((MODEL_PATH/name).read_text()):
            raise RuntimeError("Remote model code is prohibited")


def verify_protocol():
    lock = json.loads((DIRECTORY/"protocol-lock.json").read_text())
    for name in lock["sha256"]:
        if sha256(DIRECTORY/name) != lock["sha256"][name]:
            raise RuntimeError("Frozen evaluation protocol changed")
    return lock


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--run", default="run-01")
    cli.add_argument("--verify-only", action="store_true", help="Verify model and fixed protocol without importing MLX or running inference")
    args = cli.parse_args()
    if not args.run.replace("-", "").isalnum():
        raise SystemExit("Invalid run name")
    destination, runtime = DIRECTORY/(args.run+".jsonl"), DIRECTORY/(args.run+"-runtime.json")
    if destination.exists() or runtime.exists():
        raise SystemExit("Existing observations must be preserved")
    protocol = verify_protocol()
    plan = json.loads((DIRECTORY/"evaluation-plan.json").read_text())
    cases = plan["cases"]
    if len(cases) != 24 or len({case["id"] for case in cases}) != 24:
        raise RuntimeError("Expected 24 distinct frozen artificial cases")
    for case in cases:
        if type(case["writing"]) is not str or not 1 <= len(case["writing"]) <= 2000:
            raise RuntimeError("Artificial input outside bounds")
        context(case["current"])
    system = (DIRECTORY/"prompt-v1.txt").read_text()
    cache = ROOT/".local/input-routing-qwen14-cache"
    cache.mkdir(parents=True, exist_ok=True)
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1",
                      HF_HOME=str(cache/"huggingface"), XDG_CACHE_HOME=str(cache/"xdg"),
                      PYTHONDONTWRITEBYTECODE="1", TOKENIZERS_PARALLELISM="false")
    network_attempts = []
    original_connect, original_connect_ex = socket.socket.connect, socket.socket.connect_ex
    def denied_connect(sock, address):
        if sock.family in (socket.AF_INET, socket.AF_INET6):
            network_attempts.append("outbound IP connection blocked")
            raise OSError("Offline experiment: IP connections are prohibited")
        return original_connect(sock, address)
    def denied_connect_ex(sock, address):
        if sock.family in (socket.AF_INET, socket.AF_INET6):
            network_attempts.append("outbound IP connection blocked")
            raise OSError("Offline experiment: IP connections are prohibited")
        return original_connect_ex(sock, address)
    socket.socket.connect, socket.socket.connect_ex = denied_connect, denied_connect_ex
    verify_model()
    if args.verify_only:
        print("Official model and fixed protocol verified; no model import or inference")
        return
    import mlx.core as mx
    from mlx_lm import generate, load
    from mlx_lm.sample_utils import make_sampler
    if not mx.metal.is_available():
        raise RuntimeError("Metal required; do not report a silent CPU fallback")
    started = time.perf_counter()
    model, tokenizer = load(str(MODEL_PATH), tokenizer_config={"trust_remote_code": False})
    load_ms = round((time.perf_counter()-started)*1000)
    mx.random.seed(17)
    sampler = make_sampler(temp=0)
    metadata = {"startedUTC": datetime.datetime.now(datetime.timezone.utc).isoformat(), "model": MODEL_ID,
                "revision": REVISION, "weightSHA256": WEIGHT_SHA256, "protocol": protocol,
                "temperature": 0, "thinking": False, "maxTokens": 384, "attemptsPerCase": 1,
                "loadMs": load_ms, "scope": "Artificial examples reused from v1. Model comparison, not fresh held-out evaluation. No API or existing source modified.",
                "baselineRuntime": "../input-routing/run-01-runtime.json", "seed": 17,
                "recommendationDifference": "Official Qwen non-thinking guidance recommends temperature0.7; this controlled experiment uses greedy."}
    with destination.open("x") as output:
        for case in cases:
            messages = [{"role": "system", "content": system},
                        {"role": "user", "content": json.dumps({"writing": case["writing"], "current": case["current"]}, ensure_ascii=False)}]
            prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
            started = time.perf_counter()
            raw = generate(model, tokenizer, prompt=prompt, max_tokens=384, sampler=sampler, verbose=False)
            elapsed_ms = round((time.perf_counter()-started)*1000)
            result, assessment, schema_error, next_shape = None, None, None, None
            try:
                result = parse(raw)
                assessment = score(result, case["expected"])
                next_shape = transition(case["current"], result)
            except SchemaError as error:
                schema_error = str(error)
            row = {"id": case["id"], "category": case["category"], "writing": case["writing"],
                   "current": case["current"], "expected": case["expected"], "rawModelOutput": raw,
                   "result": result, "nextShape": next_shape, "schemaError": schema_error, "assessment": assessment, "elapsedMs": elapsed_ms}
            output.write(json.dumps(row, ensure_ascii=False)+"\n")
            output.flush()
            print(case["id"], "schema-ok" if schema_error is None else "schema-invalid",
                  "contract-pass" if assessment and assessment["contractPass"] else "contract-fail", elapsed_ms, flush=True)
            mx.clear_cache()
    metadata.update(completedUTC=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    mlxPeakBytes=mx.get_peak_memory(), maxRSSBytesDarwin=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                    blockedIPAttempts=len(network_attempts))
    with runtime.open("x") as output:
        json.dump(metadata, output, ensure_ascii=False, indent=2)
        output.write("\n")


if __name__ == "__main__":
    main()

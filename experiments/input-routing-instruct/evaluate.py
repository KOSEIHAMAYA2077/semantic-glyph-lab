"""Same v1 intent experiment with existing Instruct-2507 local4bit weights."""
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
MODEL_PATH = ROOT / ".local/composition-instruct-4bit"
MODEL_ID = "Qwen/Qwen3-4B-Instruct-2507"
REVISION = "cdbee75f17c01a7cc42f958dc650907174af0554"
WEIGHT_SHA256 = "2a73c6c248601ab904e035548abd8e6abb65ea27dcb5f342fb0a8910eb44173f"
MANIFEST = ROOT / "experiments/composition/instruct-quantized-manifest.json"
EXPECTED_FILES = {"README.md", "chat_template.jinja", "config.json", "generation_config.json",
                  "model.safetensors", "model.safetensors.index.json", "tokenizer.json", "tokenizer_config.json"}


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024*1024):
            digest.update(chunk)
    return digest.hexdigest()


def verify_model():
    manifest = json.loads(MANIFEST.read_text())
    if (manifest.get("sourceModel"), manifest.get("sourceRevision")) != (MODEL_ID, REVISION):
        raise RuntimeError("Unexpected Instruct source identity")
    if manifest.get("conversion") != "mlx_lm.convert 0.31.3, affine 4-bit, group size 64, dtype bfloat16, trust_remote_code false":
        raise RuntimeError("Unexpected conversion recipe")
    entries = manifest["files"]
    if len(entries) != len(EXPECTED_FILES) or {item["file"] for item in entries} != EXPECTED_FILES:
        raise RuntimeError("Unexpected converted files")
    for entry in entries:
        path = MODEL_PATH/entry["file"]
        digest = sha256(path)
        if path.stat().st_size != entry["bytes"] or digest != entry["sha256"]:
            raise RuntimeError("Converted model size or SHA256 mismatch")
        if entry["file"] == "model.safetensors" and digest != WEIGHT_SHA256:
            raise RuntimeError("Pinned local conversion SHA256 mismatch")
    config = json.loads((MODEL_PATH/"config.json").read_text())
    if config.get("quantization") != {"group_size":64,"bits":4,"mode":"affine"} or config.get("torch_dtype") != "bfloat16":
        raise RuntimeError("Unexpected local quantization")
    for name in ("config.json", "tokenizer_config.json"):
        if "auto_map" in json.loads((MODEL_PATH/name).read_text()):
            raise RuntimeError("Remote model code is prohibited")
    provenance = json.loads((DIRECTORY/"model-verification.json").read_text())
    if (provenance["sourceModel"],provenance["sourceRevision"],provenance["officialResolvedRevision"]) != (MODEL_ID,REVISION,REVISION):
        raise RuntimeError("Official source verification mismatch")
    expected_source = {"model-00001-of-00003.safetensors":"75311d91bb08cf0b882913da464a1e722a31fb44db35208663487efb7a3d8ed6",
                       "model-00002-of-00003.safetensors":"0b48adbb1f60e901153d91907ba11ce63bd4b8b584482e730f48808d055dfba1",
                       "model-00003-of-00003.safetensors":"7dd39ccca5e4de123c74c14af44c9bf2eb75df33b4614382af0134528e060d5d"}
    for record in provenance["sourceFiles"]:
        if record["file"] in expected_source:
            if record["sha256"] != expected_source[record["file"]] or record["officialLFS_SHA256"] != record["sha256"]:
                raise RuntimeError("Official source weights SHA256 mismatch")


def verify_protocol():
    lock = json.loads((DIRECTORY/"protocol-lock.json").read_text())
    for name in ("evaluation-plan.json", "prompt-v1.txt", "schema.py", "evaluate.py", "model-verification.json"):
        if sha256(DIRECTORY/name) != lock["sha256"][name]:
            raise RuntimeError("Frozen evaluation protocol changed")
    return lock


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--run", default="run-01")
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
    cache = ROOT/".local/input-routing-instruct-cache"
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
                "loadMs": load_ms, "scope": "Artificial examples only. No API or existing source modified.",
                "comparisonLimit": "Greedy and v1 prompt/schema are unchanged. Instruct-2507 differs from original Qwen3 8B/14B in training stage, parameter count, native template and local group64 versus official group128 quantization; not a size ablation."}
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

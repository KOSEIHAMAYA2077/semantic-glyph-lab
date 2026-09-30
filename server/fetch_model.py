"""Fetch only pinned, non-executable MiniLM files into this experiment's directory."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
MODEL_ID = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
REVISION = "e8f8c211226b894fcb81acc59f3b34ba3efd5f42"
MODEL_DIR = ROOT / ".local" / "semantics-model"
WEIGHT_SHA256 = "783fea82d71a58179b830a4dbd2d58447e640609e98eedf9ffa12622d375a672"
FILES = ["onnx/model_qint8_arm64.onnx", "tokenizer.json", "config.json",
         "tokenizer_config.json", "sentence_bert_config.json", "1_Pooling/config.json",
         "special_tokens_map.json", "README.md"]


def fetch() -> None:
    manifest = {"model": MODEL_ID, "revision": REVISION, "license": "Apache-2.0",
                "source": f"https://huggingface.co/{MODEL_ID}", "files": []}
    for name in FILES:
        target = MODEL_DIR / name
        target.parent.mkdir(parents=True, exist_ok=True)
        url = f"https://huggingface.co/{MODEL_ID}/resolve/{REVISION}/{name}"
        if not target.exists():
            # Keep failed partial downloads as evidence; never overwrite/delete them.
            part = target.with_name(target.name + f".partial-{time.time_ns()}")
            with urllib.request.urlopen(url, timeout=90) as source, part.open("xb") as out:
                while data := source.read(1024 * 1024):
                    out.write(data)
            digest = hashlib.sha256(part.read_bytes()).hexdigest()
            if name.endswith(".onnx") and digest != WEIGHT_SHA256:
                raise RuntimeError("Weight hash mismatch; partial file retained")
            part.rename(target)
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        if name.endswith(".onnx") and digest != WEIGHT_SHA256:
            raise RuntimeError("Existing weight hash mismatch; file left unchanged")
        entry = {"file": name, "url": url, "bytes": target.stat().st_size, "sha256": digest}
        manifest["files"].append(entry)
        print(f"{name}: {entry['bytes']} bytes {digest}", flush=True)
    manifest["totalBytes"] = sum(item["bytes"] for item in manifest["files"])
    output = ROOT / "experiments" / "semantics" / "model-manifest.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    if not output.exists():
        output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    else:
        print("Existing manifest retained; verified requested files locally")


if __name__ == "__main__":
    fetch()

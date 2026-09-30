"""Download only the pinned official Qwen safetensors and tokenizer data."""
from pathlib import Path
import hashlib
import json
import os

ROOT = Path(__file__).resolve().parents[2]
os.environ["HF_HOME"] = str(ROOT / ".local/composition-cache/huggingface")
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
from huggingface_hub import snapshot_download

MODEL = "Qwen/Qwen3-4B-MLX-4bit"
REVISION = "52a5ab34fa604bc8af6d3ce0cac0cab10b7eb495"
FILES = ["LICENSE", "README.md", "config.json", "merges.txt", "model.safetensors", "model.safetensors.index.json", "tokenizer.json", "tokenizer_config.json", "vocab.json"]
path = Path(snapshot_download(MODEL, revision=REVISION, local_dir=ROOT / ".local/composition-model", allow_patterns=FILES, token=False, max_workers=2))
records = []
for name in FILES:
    file = path / name
    digest = hashlib.sha256()
    with file.open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(block)
    records.append({"file": name, "bytes": file.stat().st_size, "sha256": digest.hexdigest()})
report = {"model": MODEL, "revision": REVISION, "source": f"https://huggingface.co/{MODEL}", "license": "Apache-2.0", "downloadedBytes": sum(x["bytes"] for x in records), "files": records, "remoteCode": False, "format": "safetensors", "retrieved": "2026-09-30"}
output = ROOT / "experiments/composition/model-manifest.json"
if output.exists():
    raise SystemExit("Manifest already exists; downloads checked but existing record retained")
output.write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({"downloadedBytes": report["downloadedBytes"], "revision": REVISION}))

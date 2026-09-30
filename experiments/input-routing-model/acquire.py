"""Download only fixed, official Qwen MLX data files; never execute model code."""
from __future__ import annotations

import concurrent.futures
import datetime
import hashlib
import json
from pathlib import Path
import shutil
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
DEST = ROOT / ".local/input-routing-qwen14-model"
MODEL = "Qwen/Qwen3-14B-MLX-4bit"
REVISION = "ba63a5141812f9870287df53341123a71ba41433"
FILES = {
    "LICENSE", "README.md", "config.json", "merges.txt", "model.safetensors.index.json",
    "tokenizer.json", "tokenizer_config.json", "vocab.json",
    "model-00001-of-00002.safetensors", "model-00002-of-00002.safetensors",
}
WEIGHTS = {
    "model-00001-of-00002.safetensors": "f2f502ca7604ad6789b124bf9cd7a192fda5a60e6f52b1fe521c3aa4dad598ce",
    "model-00002-of-00002.safetensors": "d3758e05e08bcfb5fcd1b76d74758366355c80464398702051ce0388045e898e",
}


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def save_json(path, value):
    with path.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")


def main():
    metadata_url = f"https://huggingface.co/api/models/{MODEL}/revision/{REVISION}?blobs=true"
    with urllib.request.urlopen(metadata_url, timeout=60) as response:
        metadata = json.load(response)
    if metadata["id"] != MODEL or metadata["sha"] != REVISION:
        raise RuntimeError("Official revision mismatch")
    entries = {entry["rfilename"]: entry for entry in metadata["siblings"] if entry["rfilename"] in FILES}
    if set(entries) != FILES or any(name.endswith(".py") for name in entries):
        raise RuntimeError("Unexpected model file list")
    for name, expected in WEIGHTS.items():
        if entries[name]["lfs"]["sha256"] != expected:
            raise RuntimeError("Official weight digest changed")
    expected_bytes = sum(entry["size"] for entry in entries.values())
    if shutil.disk_usage(ROOT).free - expected_bytes < 100_000_000_000:
        raise RuntimeError("Would leave less than 100 GB free")
    DEST.mkdir(parents=True, exist_ok=True)
    if any((DEST/name).exists() for name in FILES):
        raise RuntimeError("Existing model files are preserved; choose a fresh attempt")
    save_json(HERE/"official-files.json", {
        "retrievedUTC": now(), "source": metadata_url, "model": MODEL,
        "revision": REVISION, "files": list(entries.values()),
    })
    started = now()

    def download(name):
        entry = entries[name]
        url = f"https://huggingface.co/{MODEL}/resolve/{REVISION}/{name}"
        digest = hashlib.sha256()
        git_blob = hashlib.sha1(f"blob {entry['size']}\0".encode())
        size = 0
        with urllib.request.urlopen(url, timeout=120) as response, (DEST/name).open("xb") as out:
            while chunk := response.read(4*1024*1024):
                out.write(chunk)
                digest.update(chunk)
                git_blob.update(chunk)
                size += len(chunk)
        if size != entry["size"]:
            raise RuntimeError(f"Size mismatch for {name}; file retained")
        actual = digest.hexdigest()
        if "lfs" in entry:
            if actual != entry["lfs"]["sha256"]:
                raise RuntimeError(f"LFS SHA256 mismatch for {name}; file retained")
        elif git_blob.hexdigest() != entry["blobId"]:
            raise RuntimeError(f"Git blob digest mismatch for {name}; file retained")
        print(name, size, "verified", flush=True)
        return {"name": name, "bytes": size, "sha256": actual, "source": url,
                "officialLFSSHA256": entry.get("lfs", {}).get("sha256"),
                "officialGitBlobId": entry["blobId"]}

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        files = list(pool.map(download, sorted(FILES)))
    config = json.loads((DEST/"config.json").read_text())
    tokenizer = json.loads((DEST/"tokenizer_config.json").read_text())
    if "auto_map" in config or "auto_map" in tokenizer:
        raise RuntimeError("Remote code configuration prohibited")
    if config.get("model_type") != "qwen3" or config.get("quantization") != {"group_size": 128, "bits": 4}:
        raise RuntimeError("Unexpected model architecture or quantization")
    if "Apache License" not in (DEST/"LICENSE").read_text():
        raise RuntimeError("Unexpected license")
    index = json.loads((DEST/"model.safetensors.index.json").read_text())
    if set(index["weight_map"].values()) != set(WEIGHTS):
        raise RuntimeError("Unexpected safetensors index targets")
    save_json(HERE/"model-manifest.json", {
        "model": MODEL, "revision": REVISION, "license": "apache-2.0",
        "startedUTC": started, "completedUTC": now(), "files": files,
        "totalBytes": sum(item["bytes"] for item in files),
        "weightBytes": sum(item["bytes"] for item in files if item["name"] in WEIGHTS),
        "bits": 4, "groupSize": 128, "tensorCount": len(index["weight_map"]),
        "codePolicy": "No model Python code acquired. Built-in mlx_lm qwen3, trust_remote_code=False. No dependency update.",
    })
    print("Complete. No model inference performed.", flush=True)


if __name__ == "__main__":
    main()

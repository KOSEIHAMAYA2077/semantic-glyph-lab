"""Pinned official Qwen 8B MLX 4bit download; no conversion or model execution."""
import hashlib
import json
from pathlib import Path
import time
from urllib.request import urlopen

ROOT=Path(__file__).resolve().parents[2]
MODEL="Qwen/Qwen3-8B-MLX-4bit"
REVISION="383413e909f3bc5303ce195ebbdf0339c5a1a2a3"
DEST=ROOT/".local/translation-model-qwen8"
NAMES=["LICENSE","README.md","config.json","merges.txt","model.safetensors.index.json","tokenizer.json","tokenizer_config.json","vocab.json","model.safetensors"]


def main():
    with urlopen(f"https://huggingface.co/api/models/{MODEL}/revision/{REVISION}?blobs=true",timeout=30) as response:data=json.load(response)
    if data["sha"]!=REVISION or data.get("cardData",{}).get("license")!="apache-2.0":raise RuntimeError("Unexpected source metadata")
    entries={x["rfilename"]:x for x in data["siblings"]}
    DEST.mkdir(parents=True,exist_ok=True)
    manifest={"model":MODEL,"revision":REVISION,"license":"apache-2.0","source":f"https://huggingface.co/{MODEL}","date":"2026-09-30","conversion":"official pre-quantized MLX 4bit safetensors; no local conversion","files":[]}
    for name in NAMES:
        item=entries[name];path=DEST/name;url=f"https://huggingface.co/{MODEL}/resolve/{REVISION}/{name}"
        started=time.perf_counter()
        if not path.exists():
            with urlopen(url,timeout=120) as response,path.open("xb") as output:
                while chunk:=response.read(1024*1024):output.write(chunk)
        if path.stat().st_size!=item["size"]:raise RuntimeError(f"Size mismatch {name}; preserved")
        hasher=hashlib.sha256()
        with path.open("rb") as source:
            while chunk:=source.read(1024*1024):hasher.update(chunk)
        sha=hasher.hexdigest()
        if "lfs" in item:
            if sha!=item["lfs"]["sha256"]:raise RuntimeError(f"SHA mismatch {name}; preserved")
            verification="upstream LFS SHA256"
        else:
            blob=path.read_bytes()
            if hashlib.sha1(f"blob {len(blob)}\0".encode()+blob).hexdigest()!=item["blobId"]:raise RuntimeError(f"Git blob mismatch {name}; preserved")
            verification="upstream Git blob SHA1 plus recorded SHA256"
        manifest["files"].append({"name":name,"url":url,"bytes":item["size"],"sha256":sha,"verification":verification,"elapsedSeconds":round(time.perf_counter()-started,3)})
        print(name,item["size"],"verified",flush=True)
    for name in ["config.json","tokenizer_config.json"]:
        if "auto_map" in json.loads((DEST/name).read_text()):raise RuntimeError("Remote architecture code is forbidden")
    manifest["bytes"]=sum(x["bytes"] for x in manifest["files"])
    with Path(__file__).with_name("qwen8-manifest.json").open("x") as output:json.dump(manifest,output,indent=2);output.write("\n")


if __name__=="__main__":main()

"""Download one pinned official model only; preserve existing files on failures."""
import hashlib
import json
from pathlib import Path
import time
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[2]
MODEL = "Helsinki-NLP/opus-mt-ja-en"
REVISION = "0770961a39ba6bd66305b149c3f4110bcafca2e6"
DEST = ROOT / ".local/translation-model-opus-ja-en"
NAMES = ["README.md","config.json","generation_config.json","pytorch_model.bin","source.spm","target.spm","tokenizer_config.json","vocab.json"]


def main():
    with urlopen(f"https://huggingface.co/api/models/{MODEL}/revision/{REVISION}?blobs=true",timeout=30) as response:
        metadata = json.load(response)
    if metadata["sha"] != REVISION or metadata.get("cardData",{}).get("license") != "apache-2.0":
        raise RuntimeError("Source revision or license changed")
    entries = {x["rfilename"]:x for x in metadata["siblings"]}
    DEST.mkdir(parents=True,exist_ok=True)
    manifest = {"model":MODEL,"revision":REVISION,"license":"apache-2.0","source":f"https://huggingface.co/{MODEL}","date":"2026-09-30","files":[]}
    for name in NAMES:
        entry=entries[name]; path=DEST/name
        url=f"https://huggingface.co/{MODEL}/resolve/{REVISION}/{name}"
        started=time.perf_counter()
        if not path.exists():
            with urlopen(url,timeout=90) as response, path.open("xb") as output:
                while chunk:=response.read(1024*1024): output.write(chunk)
        data=path.read_bytes(); sha=hashlib.sha256(data).hexdigest()
        if len(data)!=entry["size"]: raise RuntimeError(f"Size mismatch: {name}; file preserved")
        if "lfs" in entry:
            if sha!=entry["lfs"]["sha256"]: raise RuntimeError(f"SHA mismatch: {name}; file preserved")
            verification="upstream LFS SHA256"
        else:
            git_hash=hashlib.sha1(f"blob {len(data)}\0".encode()+data).hexdigest()
            if git_hash!=entry["blobId"]: raise RuntimeError(f"Git blob hash mismatch: {name}; file preserved")
            verification="upstream Git blob SHA1 plus recorded local SHA256"
        manifest["files"].append({"name":name,"url":url,"bytes":len(data),"sha256":sha,"verification":verification,"elapsedSeconds":round(time.perf_counter()-started,3)})
        print(name,len(data),"verified",flush=True)
    for name in ["config.json","tokenizer_config.json"]:
        config=json.loads((DEST/name).read_text())
        if "auto_map" in config: raise RuntimeError("Model-specific code is not permitted")
    manifest["bytes"]=sum(item["bytes"] for item in manifest["files"])
    with Path(__file__).with_name("model-manifest.json").open("x") as output:
        json.dump(manifest,output,indent=2);output.write("\n")


if __name__=="__main__":main()

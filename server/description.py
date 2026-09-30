"""Description-only local Qwen 8B service, separate from the 4B composer."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import threading
from http.server import ThreadingHTTPServer

from composition import Composer, make_handler as composition_handler, MAX_TEXT

ROOT=Path(__file__).resolve().parents[1]
MODEL_ID="Qwen/Qwen3-8B-MLX-4bit"
REVISION="383413e909f3bc5303ce195ebbdf0339c5a1a2a3"
WEIGHT_SHA256="fcc83d7537bee76cc143be3e25f8954b816798f93528103db1cddb02977c5617"
PROMPT_SHA256="29101ddd61f921b98c66f89b6782e92b54e93a4c259a025310b4f2c1cdf8464e"
MODEL_PATH=ROOT/".local/translation-model-qwen8"
MANIFEST_PATH=ROOT/"experiments/translation-model/qwen8-manifest.json"
PROMPT_PATH=ROOT/"experiments/translation-model/qwen-description-prompt.txt"
EXPECTED_FILES={"LICENSE","README.md","config.json","merges.txt","model.safetensors.index.json","tokenizer.json","tokenizer_config.json","vocab.json","model.safetensors"}


class Describer:
    # Reuse only the reviewed description/validation/locking method. This
    # service has no compose method or unrelated composition prompt.
    describe=Composer.describe

    def __init__(self,prompt):
        os.environ.update(HF_HUB_OFFLINE="1",TRANSFORMERS_OFFLINE="1",HF_HUB_DISABLE_TELEMETRY="1",HF_HOME=str(ROOT/".local/translation-model-cache/huggingface"))
        import mlx.core as mx
        from mlx_lm import load
        from mlx_lm.sample_utils import make_sampler
        self.mx=mx;mx.random.seed(17)
        self.model,self.tokenizer=load(str(MODEL_PATH),tokenizer_config={"trust_remote_code":False})
        self.model_id=MODEL_ID;self.revision=REVISION
        self.description_prompt=prompt;self.description_sampler=make_sampler(temp=0)
        self.lock=threading.Lock()


def verify_model_files(model_path=MODEL_PATH, manifest_path=MANIFEST_PATH, prompt_path=PROMPT_PATH):
    manifest=json.loads(manifest_path.read_text())
    if manifest.get("model")!=MODEL_ID or manifest.get("revision")!=REVISION or manifest.get("license")!="apache-2.0":
        raise RuntimeError("Unexpected official model identity")
    entries=manifest.get("files",[])
    if len(entries)!=len(EXPECTED_FILES) or {item.get("name") for item in entries}!=EXPECTED_FILES:
        raise RuntimeError("Unexpected model file list")
    for item in entries:
        path=model_path/item["name"]
        if path.stat().st_size!=item["bytes"]:raise RuntimeError("Model file size mismatch")
        digest=hashlib.sha256()
        with path.open("rb") as stream:
            while chunk:=stream.read(1024*1024):digest.update(chunk)
        actual=digest.hexdigest()
        if actual!=item["sha256"] or (item["name"]=="model.safetensors" and actual!=WEIGHT_SHA256):
            raise RuntimeError("Official model SHA256 mismatch")
    for name in ["config.json","tokenizer_config.json"]:
        if "auto_map" in json.loads((model_path/name).read_text()):raise RuntimeError("Remote model code is prohibited")
    prompt=prompt_path.read_text()
    if hashlib.sha256(prompt.encode()).hexdigest()!=PROMPT_SHA256:raise RuntimeError("Comparison prompt differs from the pinned version")
    return prompt


def make_handler(describer,port):
    Base=composition_handler(describer,port)
    class Handler(Base):
        server_version="LocalDescription/0.1"

        def do_POST(self):
            if not self.allowed():return self.reply(403,{"error":"Origin or Host is not allowed"})
            if self.path!="/describe":return self.reply(404,{"error":"Not found"})
            return super().do_POST()

        def do_GET(self):
            if not self.allowed():return self.reply(403,{"error":"Origin or Host is not allowed"})
            if self.path!="/health":return self.reply(404,{"error":"Not found"})
            return self.reply(200,{"ok":True,"busy":describer.lock.locked(),"model":MODEL_ID,"revision":REVISION,"local":True,"capabilities":["describe"],"maxCharacters":MAX_TEXT,"temperature":0,"thinking":False,"promptSHA256":PROMPT_SHA256})

        def do_OPTIONS(self):
            if not self.allowed():return self.reply(403,{"error":"Origin or Host is not allowed"})
            if self.path not in {"/health","/describe"}:return self.reply(404,{"error":"Not found"})
            return super().do_OPTIONS()

    return Handler


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port",type=int,default=4188)
    args=parser.parse_args()
    if not 1024<=args.port<=65535:parser.error("Port outside limits")
    prompt=verify_model_files()
    describer=Describer(prompt)
    server=ThreadingHTTPServer(("127.0.0.1",args.port),make_handler(describer,args.port))
    def stop(_signum,_frame):raise KeyboardInterrupt
    signal.signal(signal.SIGTERM,stop)
    print(f"Description ready at http://127.0.0.1:{args.port}; local 8B model loaded; input logging disabled",flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close();describer.mx.clear_cache()


if __name__=="__main__":main()

"""CPU-only translation of predeclared artificial cases; no API replacement."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import resource
import time

ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = Path(__file__).resolve().parent
MODEL_PATH = ROOT / ".local/translation-model-opus-ja-en"


def load_model():
    os.environ.update(HF_HUB_OFFLINE="1",TRANSFORMERS_OFFLINE="1",HF_HUB_DISABLE_TELEMETRY="1",HF_HOME=str(ROOT/".local/translation-model-cache/huggingface"),TOKENIZERS_PARALLELISM="false")
    import torch
    from transformers import MarianConfig, MarianMTModel, MarianTokenizer
    torch.set_num_threads(4)
    manifest=json.loads((DIRECTORY/"model-manifest.json").read_text())
    for item in manifest["files"]:
        data=(MODEL_PATH/item["name"]).read_bytes()
        if len(data)!=item["bytes"] or hashlib.sha256(data).hexdigest()!=item["sha256"]:
            raise RuntimeError("Official source file failed hash verification")
    config=json.loads((MODEL_PATH/"config.json").read_text())
    if "auto_map" in config:raise RuntimeError("Remote architecture code is prohibited")
    # The pinned official main branch has a PyTorch checkpoint, not safetensors.
    # Restricted loading is explicit; no user-supplied files or Python objects.
    started=time.perf_counter()
    state=torch.load(MODEL_PATH/"pytorch_model.bin",map_location="cpu",weights_only=True)
    if not isinstance(state,dict) or not all(isinstance(k,str) and isinstance(v,torch.Tensor) for k,v in state.items()):
        raise RuntimeError("Checkpoint must contain tensors only")
    if not all(torch.isfinite(v).all().item() for v in state.values() if v.is_floating_point()):
        raise RuntimeError("Non-finite model weights")
    model=MarianMTModel(MarianConfig(**config)).to("cpu")
    model.load_state_dict(state,strict=True)
    model.eval()
    tokenizer=MarianTokenizer.from_pretrained(str(MODEL_PATH),local_files_only=True,trust_remote_code=False)
    return model,tokenizer,torch,{"loadMs":round((time.perf_counter()-started)*1000),"tensorCount":len(state),"parameters":sum(p.numel() for p in model.parameters()),"device":str(next(model.parameters()).device),"weightsOnly":True,"strictStateDict":True}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--run",default="run-01")
    args=parser.parse_args()
    if not args.run.replace("-","").isalnum():raise SystemExit("Invalid run name")
    destination=DIRECTORY/(args.run+".jsonl")
    meta_destination=DIRECTORY/(args.run+"-runtime.json")
    if destination.exists() or meta_destination.exists():raise SystemExit("Existing run must be preserved")
    regression=ROOT/"experiments/translation/evaluation-plan.json"
    fresh=DIRECTORY/"fresh-plan.json"
    cases=[{**row,"group":"reused-regression"} for row in json.loads(regression.read_text())["cases"]]+[{**row,"group":"first-pass-fresh"} for row in json.loads(fresh.read_text())["cases"]]
    model,tokenizer,torch,metrics=load_model()
    metrics.update(model="Helsinki-NLP/opus-mt-ja-en",numBeams=6,maxNewTokens=128,doSample=False,threads=4,regressionPlanSHA256=hashlib.sha256(regression.read_bytes()).hexdigest(),freshPlanSHA256=hashlib.sha256(fresh.read_bytes()).hexdigest())
    with destination.open("x") as output:
        for case in cases:
            started=time.perf_counter()
            inputs=tokenizer([case["text"]],return_tensors="pt",padding=True,truncation=False)
            if inputs["input_ids"].shape[-1]>512:raise RuntimeError("Input would exceed source context")
            with torch.inference_mode():
                generated=model.generate(**inputs,num_beams=6,max_new_tokens=128,do_sample=False,renormalize_logits=True,early_stopping=True)
            text=tokenizer.batch_decode(generated,skip_special_tokens=True)[0]
            row={**case,"text_en":text,"elapsedMs":round((time.perf_counter()-started)*1000),"sourceTokens":inputs["input_ids"].shape[-1],"generatedTokens":generated.shape[-1],"model":metrics["model"],"device":"cpu"}
            output.write(json.dumps(row,ensure_ascii=False)+"\n");output.flush()
            print(case["id"],row["elapsedMs"],flush=True)
    metrics["maxRSSBytesDarwin"]=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    with meta_destination.open("x") as output:json.dump(metrics,output,indent=2);output.write("\n")


if __name__=="__main__":main()

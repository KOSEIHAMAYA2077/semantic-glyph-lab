"""Artificial 4B/8B comparison; same frozen visual-description prompt and greedy decode."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import resource
import time
from urllib.error import HTTPError
from urllib.request import Request,urlopen

ROOT=Path(__file__).resolve().parents[2]
DIRECTORY=Path(__file__).resolve().parent
MODEL_PATH=ROOT/".local/translation-model-qwen8"
MODEL_ID="Qwen/Qwen3-8B-MLX-4bit"


def main():
    parser=argparse.ArgumentParser();parser.add_argument("--run",default="qwen8-run-01");parser.add_argument("--baseline4b",action="store_true")
    args=parser.parse_args()
    if not args.run.replace("-","").isalnum():raise SystemExit("Invalid run name")
    destination=DIRECTORY/(args.run+".jsonl");metadata_path=DIRECTORY/(args.run+"-runtime.json")
    if destination.exists() or metadata_path.exists():raise SystemExit("Existing observations must be preserved")
    prompt_path=DIRECTORY/"qwen-description-prompt.txt";system_prompt=prompt_path.read_text()
    regression_path=ROOT/"experiments/translation/evaluation-plan.json";fresh_path=DIRECTORY/"fresh-plan.json"
    fresh=[{**row,"group":"first-pass-for-qwen"} for row in json.loads(fresh_path.read_text())["cases"]]
    cases=[{**row,"group":"reused-regression"} for row in json.loads(regression_path.read_text())["cases"]]+fresh
    if args.baseline4b:
        baseline_destination=DIRECTORY/"qwen4b-fresh-01.jsonl"
        if baseline_destination.exists():raise SystemExit("Existing baseline must be preserved")
        if (ROOT/"server/composition-description-prompt.txt").read_text()!=system_prompt:raise SystemExit("Live 4B prompt file differs from frozen comparison")
        with baseline_destination.open("x") as output:
            for case in fresh:
                started=time.perf_counter()
                request=Request("http://127.0.0.1:4185/describe",data=json.dumps({"text":case["text"]}).encode(),headers={"Content-Type":"application/json","Origin":"http://127.0.0.1:4183"})
                try:response=urlopen(request,timeout=90)
                except HTTPError as error:response=error
                row={**case,"status":response.status,"result":json.loads(response.read()),"httpWallMs":round((time.perf_counter()-started)*1000)}
                output.write(json.dumps(row,ensure_ascii=False)+"\n");output.flush()
                print("4B",case["id"],row["status"],flush=True)
    os.environ.update(HF_HUB_OFFLINE="1",TRANSFORMERS_OFFLINE="1",HF_HUB_DISABLE_TELEMETRY="1",HF_HOME=str(ROOT/".local/translation-model-cache/huggingface"))
    manifest=json.loads((DIRECTORY/"qwen8-manifest.json").read_text())
    for item in manifest["files"]:
        path=MODEL_PATH/item["name"];digest=hashlib.sha256()
        with path.open("rb") as stream:
            while chunk:=stream.read(1024*1024):digest.update(chunk)
        if path.stat().st_size!=item["bytes"] or digest.hexdigest()!=item["sha256"]:raise RuntimeError("Official local model file failed verification")
    import mlx.core as mx
    from mlx_lm import load,generate
    from mlx_lm.sample_utils import make_sampler
    source=ROOT/"server/composition.py"
    spec=importlib.util.spec_from_file_location("description_validation",source);validation=importlib.util.module_from_spec(spec);spec.loader.exec_module(validation)
    started=time.perf_counter();model,tokenizer=load(str(MODEL_PATH),tokenizer_config={"trust_remote_code":False})
    mx.random.seed(17);sampler=make_sampler(temp=0)
    metrics={"model":MODEL_ID,"revision":manifest["revision"],"loadMs":round((time.perf_counter()-started)*1000),"temperature":0,"thinking":False,"maxTokens":512,"maxAttempts":2,"promptSHA256":hashlib.sha256(system_prompt.encode()).hexdigest(),"validationSourceSHA256":hashlib.sha256(source.read_bytes()).hexdigest(),"freshPlanSHA256":hashlib.sha256(fresh_path.read_bytes()).hexdigest(),"regressionPlanSHA256":hashlib.sha256(regression_path.read_bytes()).hexdigest(),"comparisonLimit":"8B original Qwen3 vs 4B Instruct-2507; quantization group128 vs group64. Not an isolated parameter-count ablation. Non-thinking greedy controls the comparison but differs from 8B official temperature0.7 recommendation."}
    with destination.open("x") as output:
        for case in cases:
            started=time.perf_counter();messages=[{"role":"system","content":system_prompt},{"role":"user","content":case["text"]}];raw_outputs=[];result=None;status=422
            for attempt in range(2):
                prompt=tokenizer.apply_chat_template(messages,tokenize=False,add_generation_prompt=True,enable_thinking=False)
                raw=generate(model,tokenizer,prompt=prompt,max_tokens=512,sampler=sampler,verbose=False);raw_outputs.append(raw)
                try:result=validation.parse_description(raw);status=200;break
                except validation.NoVisualSubjectError:result={"error":"No concrete visual subject was identified"};break
                except validation.CompositionError as error:
                    result={"error":"Invalid description schema"}
                    messages.append({"role":"assistant","content":raw})
                    messages.append({"role":"user","content":f"Format error: {error}. Return only the required JSON with text_en. Keep the original concrete meaning, within 300 ASCII characters and 45 words. If there is no concrete subject, use an empty string."})
            row={**case,"status":status,"result":result,"elapsedMs":round((time.perf_counter()-started)*1000),"attempts":attempt+1,"rawModelOutputs":raw_outputs,"model":MODEL_ID}
            output.write(json.dumps(row,ensure_ascii=False)+"\n");output.flush();print("8B",case["id"],status,row["elapsedMs"],flush=True)
            mx.clear_cache()
    metrics.update(mlxPeakBytes=mx.get_peak_memory(),maxRSSBytesDarwin=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    with metadata_path.open("x") as output:json.dump(metrics,output,indent=2);output.write("\n")


if __name__=="__main__":main()

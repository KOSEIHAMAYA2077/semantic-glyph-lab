"""Independent two-stage intent experiment. Artificial cases only, one draw per stage."""
from __future__ import annotations

import argparse
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import resource
import socket
import sys
import time

import contracts

ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = Path(__file__).resolve().parent
V1_DIRECTORY = DIRECTORY.parent/"input-routing"
sys.path.insert(0, str(V1_DIRECTORY))
spec = importlib.util.spec_from_file_location("frozen_model_verifier", V1_DIRECTORY/"evaluate.py")
BASELINE = importlib.util.module_from_spec(spec)
spec.loader.exec_module(BASELINE)


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_protocol():
    lock = json.loads((DIRECTORY/"protocol-lock.json").read_text())
    for path, expected in lock["sha256"].items():
        if sha256(ROOT/path) != expected:
            raise RuntimeError("Frozen protocol changed")
    if (DIRECTORY/"description-prompt.txt").read_bytes() != (ROOT/"experiments/translation-model/qwen-description-prompt.txt").read_bytes():
        raise RuntimeError("Existing description prompt must remain unchanged")
    fresh_lock = json.loads((DIRECTORY/"fresh-plan-lock.json").read_text())
    if sha256(DIRECTORY/"fresh-plan.json") != fresh_lock["sha256"] or fresh_lock["beforePrompts"] is not True:
        raise RuntimeError("Fresh cases were not frozen before prompts")
    return lock


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--run", default="run-01")
    args = cli.parse_args()
    if not args.run.replace("-", "").isalnum():raise SystemExit("Invalid run name")
    destination, metadata_path = DIRECTORY/(args.run+".jsonl"), DIRECTORY/(args.run+"-runtime.json")
    if destination.exists() or metadata_path.exists():raise SystemExit("Existing results must be preserved")
    lock = verify_protocol()
    regression = [{**x,"evaluationGroup":"regression-v1"} for x in json.loads((V1_DIRECTORY/"evaluation-plan.json").read_text())["cases"]]
    fresh = [{**x,"evaluationGroup":"first-pass-v2"} for x in json.loads((DIRECTORY/"fresh-plan.json").read_text())["cases"]]
    cases = regression+fresh
    if len(regression)!=24 or len(fresh)!=12 or len({x["id"] for x in cases})!=36:
        raise RuntimeError("Expected 24 regression and 12 new distinct cases")
    for case in cases:
        contracts.summarize_current(case["current"])
        if type(case["writing"]) is not str or not 1<=len(case["writing"])<=2000:
            raise RuntimeError("Artificial writing outside bounds")
    prompts = {name:(DIRECTORY/(name+"-prompt.txt")).read_text() for name in ("action","edit","description")}
    cache = ROOT/".local/input-routing-v2-cache"
    cache.mkdir(parents=True,exist_ok=True)
    os.environ.update(HF_HUB_OFFLINE="1",TRANSFORMERS_OFFLINE="1",HF_HUB_DISABLE_TELEMETRY="1",
                      HF_HOME=str(cache/"huggingface"),XDG_CACHE_HOME=str(cache/"xdg"),PYTHONDONTWRITEBYTECODE="1",TOKENIZERS_PARALLELISM="false")
    blocked = []
    old_connect,old_connect_ex=socket.socket.connect,socket.socket.connect_ex
    def guard(original):
        def connect(sock,address):
            if sock.family in (socket.AF_INET,socket.AF_INET6):
                blocked.append(1)
                raise OSError("Offline experiment: IP connection prohibited")
            return original(sock,address)
        return connect
    socket.socket.connect,socket.socket.connect_ex=guard(old_connect),guard(old_connect_ex)
    BASELINE.verify_model()
    import mlx.core as mx
    from mlx_lm import load,generate
    from mlx_lm.sample_utils import make_sampler
    if not mx.metal.is_available():raise RuntimeError("Metal required")
    started=time.perf_counter()
    model,tokenizer=load(str(BASELINE.MODEL_PATH),tokenizer_config={"trust_remote_code":False})
    load_ms=round((time.perf_counter()-started)*1000)
    sampler=make_sampler(temp=.7,top_p=.8,top_k=20)
    metadata={"startedUTC":datetime.datetime.now(datetime.timezone.utc).isoformat(),"model":BASELINE.MODEL_ID,
              "revision":BASELINE.REVISION,"weightSHA256":BASELINE.WEIGHT_SHA256,"protocol":lock,
              "temperature":.7,"topP":.8,"topK":20,"thinking":False,"seed":17,
              "seedPolicy":"Reset seed17 before each stage; exactly one draw, no repair or resampling.",
              "maxTokens":{"action":64,"edit":256,"description":512},"loadMs":load_ms,
              "comparisonLimit":"Architecture, prompts and sampling all differ from v1; not an isolated causal ablation. New English descriptions are not form-ID or count-patch outputs."}
    def call(stage,payload):
        messages=[{"role":"system","content":prompts[stage]},
                  {"role":"user","content":payload if type(payload) is str else json.dumps(payload,ensure_ascii=False)}]
        prompt=tokenizer.apply_chat_template(messages,tokenize=False,add_generation_prompt=True,enable_thinking=False)
        mx.random.seed(17)
        started=time.perf_counter()
        raw=generate(model,tokenizer,prompt=prompt,max_tokens=metadata["maxTokens"][stage],sampler=sampler,verbose=False)
        elapsed=round((time.perf_counter()-started)*1000)
        result,error=None,None
        try:result=getattr(contracts,stage)(raw)
        except contracts.SchemaError as failure:error=str(failure)
        response={"rawModelOutput":raw,"result":result,"schemaError":error,"elapsedMs":elapsed,
                  "outputTokens":len(tokenizer.encode(raw))}
        mx.clear_cache()
        return response
    with destination.open("x") as output:
        for case in cases:
            started=time.perf_counter()
            first=call("action",{"writing":case["writing"],"current":contracts.summarize_current(case["current"])})
            chosen=first["result"]["action"] if first["result"] else None
            second=None
            second_kind=None
            if chosen=="new":
                second_kind="description"
                # Intentionally no current shape, form list or expected answer.
                second=call("description",case["writing"])
            elif chosen=="edit":
                second_kind="edit"
                second=call("edit",{"writing":case["writing"],"attributes":case["current"]["attributes"]})
            assessment={"actionMatches":chosen==case["expected"]["action"],
                        "pipelineSchemaValid":first["schemaError"] is None and (second is None or second["schemaError"] is None),
                        "editChanges":None,"newDescriptionNeedsHumanReview":second_kind=="description" and bool(second["result"])}
            if chosen=="edit" and case["expected"]["action"]=="edit" and second["result"]:
                assessment["editChanges"]=contracts.score_changes(second["result"]["changes"],case["expected"].get("changes",{}))
            row={**case,"actionStage":first,"secondStageKind":second_kind,"secondStage":second,
                 "assessment":assessment,"totalMs":round((time.perf_counter()-started)*1000)}
            output.write(json.dumps(row,ensure_ascii=False)+"\n");output.flush()
            print(case["evaluationGroup"],case["id"],chosen,
                  "action-match" if assessment["actionMatches"] else "action-mismatch",
                  "schema-ok" if assessment["pipelineSchemaValid"] else "schema-invalid",row["totalMs"],flush=True)
    metadata.update(completedUTC=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    mlxPeakBytes=mx.get_peak_memory(),maxRSSBytesDarwin=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                    blockedIPAttempts=len(blocked))
    with metadata_path.open("x") as output:json.dump(metadata,output,ensure_ascii=False,indent=2);output.write("\n")


if __name__=="__main__":main()

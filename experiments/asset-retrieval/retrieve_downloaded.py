"""Post-selection diagnostic on three local assets, not an additional held-out test."""
from pathlib import Path
import datetime
import hashlib
import json
import os
import socket
import sys
import time

ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/"server"))
os.environ.update(HF_HUB_OFFLINE="1",TRANSFORMERS_OFFLINE="1",PYTHONDONTWRITEBYTECODE="1")


def main():
    manifest_path=ROOT/"public/retrieval-models/manifest.json"
    data=manifest_path.read_bytes()
    models=json.loads(data)["models"]
    cases=json.loads((HERE/"protocol.json").read_text())["cases"]
    lock={"frozenUTC":datetime.datetime.now(datetime.timezone.utc).isoformat(),"manifestSHA256":hashlib.sha256(data).hexdigest(),"cases":"Same ten artificial queries, reused after selecting assets; no new held-out claim.","caption":"name + new experiment description","count":3,"topK":3,"threshold":None,"policy":"Ranking diagnostic only. Do not calibrate a threshold or claim all inputs should select an asset."}
    with (HERE/"downloaded-protocol.json").open("x") as out:json.dump(lock,out,indent=2);out.write("\n")
    attempts=[]
    old=socket.socket.connect
    def deny(sock,address):
        if sock.family in (socket.AF_INET,socket.AF_INET6):
            attempts.append(1);raise OSError("Offline experiment")
        return old(sock,address)
    socket.socket.connect=deny
    from interpreter import Embeddings
    import numpy as np
    model=Embeddings()
    vectors=model.encode([item["name"]+". "+item["description"] for item in models])
    rows=[]
    for case in cases:
        start=time.perf_counter()
        scores=vectors@model.encode([case["text"]])[0]
        order=np.argsort(-scores)
        row={"id":case["id"],"text":case["text"],"elapsedMs":round((time.perf_counter()-start)*1000,3),"ranked":[{"id":models[i]["id"],"score":round(float(scores[i]),6)} for i in order]}
        rows.append(row);print(row,flush=True)
    with (HERE/"downloaded-results.json").open("x") as out:json.dump({"protocol":lock,"blockedIPAttempts":len(attempts),"model":"same verified multilingual MiniLM int8 ONNX, CPU","encoderCodeSHA256":hashlib.sha256((ROOT/"server/interpreter.py").read_bytes()).hexdigest(),"cases":rows},out,ensure_ascii=False,indent=2);out.write("\n")


if __name__=="__main__":main()

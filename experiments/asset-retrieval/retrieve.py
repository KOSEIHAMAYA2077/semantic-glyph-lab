"""Offline CPU-only ranking of artificial Japanese queries over official model metadata."""
from __future__ import annotations

import datetime
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import socket
import time

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
MODEL = ROOT / ".local/semantics-model"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    lock = json.loads((HERE/"protocol-lock.json").read_text())
    if digest(HERE/"protocol.json") != lock["protocolSHA256"]:
        raise RuntimeError("Frozen protocol changed")
    protocol = json.loads((HERE/"protocol.json").read_text())
    record = json.loads((HERE/"catalogue-record.json").read_text())
    metadata_path = ROOT/protocol["rawMetadataLocation"]
    if digest(metadata_path) != record["sha256"]:
        raise RuntimeError("Catalogue changed")
    catalogue = json.loads(metadata_path.read_text())
    if any(item["type"] != 2 for item in catalogue.values()):
        raise RuntimeError("Non-model catalogue entry")
    manifest = json.loads((ROOT/"experiments/semantics/model-manifest.json").read_text())
    for entry in manifest["files"]:
        path = MODEL/entry["file"]
        if path.stat().st_size != entry["bytes"] or digest(path) != entry["sha256"]:
            raise RuntimeError("Model file differs from verified official snapshot")
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1", PYTHONDONTWRITEBYTECODE="1")
    attempts = []
    original = socket.socket.connect
    def no_network(sock, address):
        if sock.family in (socket.AF_INET, socket.AF_INET6):
            attempts.append("blocked")
            raise OSError("Offline semantic retrieval")
        return original(sock, address)
    socket.socket.connect = no_network
    import numpy as np
    import onnxruntime as ort
    from tokenizers import Tokenizer
    tokenizer = Tokenizer.from_file(str(MODEL/"tokenizer.json"))
    tokenizer.no_truncation()
    ids = sorted(catalogue)
    names = [catalogue[key]["name"] for key in ids]
    captions = [catalogue[key]["name"] + ". " + catalogue[key].get("description", "") for key in ids]
    queries = [case["text"] for case in protocol["cases"]]
    too_long = [ids[i] for i, encoding in enumerate(tokenizer.encode_batch(captions)) if len(encoding.ids) > 128]
    if too_long:
        raise RuntimeError("Catalogue descriptions exceed fixed 128-token context: " + str(too_long))
    if any(len(encoding.ids) > 128 for encoding in tokenizer.encode_batch(queries)):
        raise RuntimeError("Artificial query exceeds context")
    tokenizer.enable_padding(pad_id=tokenizer.token_to_id("<pad>"), pad_token="<pad>")
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    options.log_severity_level = 3
    started = time.perf_counter()
    session = ort.InferenceSession(str(MODEL/"onnx/model_qint8_arm64.onnx"), sess_options=options, providers=["CPUExecutionProvider"])
    load_ms = (time.perf_counter()-started)*1000
    input_names = {item.name for item in session.get_inputs()}
    def encode(texts):
        encodings = tokenizer.encode_batch(texts)
        feed = {"input_ids": np.asarray([item.ids for item in encodings], dtype=np.int64),
                "attention_mask": np.asarray([item.attention_mask for item in encodings], dtype=np.int64),
                "token_type_ids": np.asarray([item.type_ids for item in encodings], dtype=np.int64)}
        output = session.run(None, {key:value for key,value in feed.items() if key in input_names})[0]
        mask = feed["attention_mask"][...,None]
        vectors = (output*mask).sum(axis=1)/mask.sum(axis=1).clip(min=1)
        return vectors/np.linalg.norm(vectors,axis=1,keepdims=True).clip(min=1e-12)
    matrices, index_ms = {}, {}
    for mode, values in [("name", names), ("name-description", captions)]:
        started = time.perf_counter()
        matrices[mode] = np.concatenate([encode(values[i:i+8]) for i in range(0,len(values),8)])
        index_ms[mode] = round((time.perf_counter()-started)*1000,3)
        print(mode, "indexed", len(values), "in", index_ms[mode], "ms", flush=True)
    rows = []
    for case in protocol["cases"]:
        started = time.perf_counter()
        vector = encode([case["text"]])[0]
        results = {}
        for mode, matrix in matrices.items():
            scores = matrix@vector
            order = np.argsort(-scores,kind="stable")[:protocol["topK"]]
            results[mode] = [{"id":ids[i],"name":names[i],"score":round(float(scores[i]),6),"source":"https://polyhaven.com/a/"+ids[i]} for i in order]
        row = {"id":case["id"],"text":case["text"],"expectedTarget":case["target"],"requiredQualifiers":case["requiredQualifiers"],"elapsedMs":round((time.perf_counter()-started)*1000,3),"rankings":results}
        rows.append(row)
        print(case["id"],[(m,v[0]["id"],v[0]["score"]) for m,v in results.items()],flush=True)
    report = {"completedUTC":datetime.datetime.now(datetime.timezone.utc).isoformat(),"providerCredit":"Powered by Poly Haven", "protocol":lock,"catalogue":record,
              "model":{key:manifest[key] for key in ["model","revision","license","source"]},
              "modelManifestSHA256":digest(ROOT/"experiments/semantics/model-manifest.json"),"providers":session.get_providers(),
              "packages":{name:importlib.metadata.version(name) for name in ["numpy","onnxruntime","tokenizers"]},
              "loadMs":round(load_ms,3),"indexMs":index_ms,"captionTruncations":0,"blockedIPAttempts":len(attempts),"cases":rows}
    with (HERE/"retrieval-results.json").open("x") as out:
        json.dump(report,out,ensure_ascii=False,indent=2);out.write("\n")


if __name__ == "__main__":
    main()

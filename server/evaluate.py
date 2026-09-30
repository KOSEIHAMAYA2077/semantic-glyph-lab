"""Reproducible synthetic evaluation; saves only the authored fixture and metrics."""
from __future__ import annotations

import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import statistics
import time

from catalog import DEFAULT_FORM
from fetch_model import REVISION
from interpreter import Embeddings, Interpreter, MIN_MARGIN, MIN_SCORE

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", default="experiments/semantics/heldout-v1.json")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    fixture = ROOT / args.fixture
    output = ROOT / args.output
    if output.exists():
        raise SystemExit("Refusing to overwrite prior results. Choose a new --output path.")
    raw = fixture.read_bytes()
    start = time.perf_counter()
    engine = Interpreter(Embeddings())
    load_ms = (time.perf_counter() - start) * 1000
    rows = []
    for case in json.loads(raw)["cases"]:
        for mode in ("rules", "semantic"):
            previous = dict(DEFAULT_FORM, object=case.get("previous", "sphere"))
            result = engine.interpret(case["text"], previous, mode)
            wanted = case["object"]
            correct = result["spec"]["object"] == wanted if wanted else result["source"] == "unchanged"
            attribute_correct = all(result["spec"].get(key) == value for key, value in case.get("attributes", {}).items())
            ink_correct = not case.get("ink") or bool(result.get("ink"))
            # A preserved initial sphere is not successful retrieval of a sphere.
            if case.get("group") == "paraphrase":
                correct = correct and result["source"] != "unchanged"
            rows.append({"id": case.get("id", case["text"]), "group": case.get("group", "development"),
                         "mode": mode, "expectedObject": wanted, "objectCorrect": correct,
                         "attributesCorrect": attribute_correct, "inkCorrect": ink_correct,
                         "allCorrect": correct and attribute_correct and ink_correct, "result": result})
    grouped = defaultdict(list)
    for row in rows:
        grouped[row["mode"] + ":" + row["group"]].append(row)
    summary = {group: {"correct": sum(row["allCorrect"] for row in values), "count": len(values),
                       "objectCorrect": sum(row["objectCorrect"] for row in values)} for group, values in grouped.items()}
    latency = {}
    for mode in ("rules", "semantic"):
        values = [row["result"]["elapsedMs"] for row in rows if row["mode"] == mode]
        values.sort()
        latency[mode] = {"medianMs": statistics.median(values), "p95Ms": values[min(len(values)-1, int(len(values)*.95))], "maxMs": max(values)}
    report = {"fixture": args.fixture, "fixtureSha256": hashlib.sha256(raw).hexdigest(),
              "modelRevision": REVISION, "threshold": {"score": MIN_SCORE, "margin": MIN_MARGIN},
              "catalogSha256": hashlib.sha256((ROOT / "server/catalog.py").read_bytes()).hexdigest(),
              "interpreterSha256": hashlib.sha256((ROOT / "server/interpreter.py").read_bytes()).hexdigest(),
              "loadMs": round(load_ms, 2), "summary": summary, "latency": latency, "rows": rows}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"summary": summary, "latency": latency, "loadMs": report["loadMs"]}, ensure_ascii=False, indent=2))
    print("Failures:")
    for row in rows:
        if row["mode"] == "semantic" and not row["allCorrect"]:
            print(json.dumps(row, ensure_ascii=False))


if __name__ == "__main__":
    main()

"""Report the frozen contract unchanged; raw diagnostics do not repair any output."""
from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import statistics

HERE = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", default="run-01")
    args = parser.parse_args()
    if not args.run.replace("-", "").isalnum():
        raise SystemExit("Invalid run name")
    rows = [json.loads(line) for line in (HERE/(args.run+".jsonl")).read_text().splitlines()]
    runtime = json.loads((HERE/(args.run+"-runtime.json")).read_text())
    plan = json.loads((HERE/"evaluation-plan.json").read_text())
    if len(rows) != 24 or [row["id"] for row in rows] != [case["id"] for case in plan["cases"]]:
        raise RuntimeError("Incomplete or reordered run")
    if not runtime.get("completedUTC"):
        raise RuntimeError("Run has not completed")
    raw = []
    for row in rows:
        try:
            value = json.loads(row["rawModelOutput"])
        except json.JSONDecodeError:
            value = None
        raw.append(value)
    unknown_ids = [row["id"] for row in rows if row["expected"].get("target") == "unknown"]
    unknown_raw = []
    for row, value in zip(rows, raw):
        if row["id"] not in unknown_ids:
            continue
        target = value.get("target") if isinstance(value, dict) else None
        unknown_raw.append({"id": row["id"], "rawAction": value.get("action") if isinstance(value, dict) else None,
                            "rawTarget": target, "schemaValid": row["schemaError"] is None})
    latencies = [row["elapsedMs"] for row in rows]
    report = {
        "cases": len(rows),
        "jsonSyntaxValid": sum(value is not None for value in raw),
        "schemaValid": sum(row["schemaError"] is None for row in rows),
        "strictPredeclaredContractPass": sum(bool(row["assessment"] and row["assessment"]["contractPass"]) for row in rows),
        "rawActionMatches": sum(isinstance(value, dict) and value.get("action") == row["expected"]["action"] for row, value in zip(rows, raw)),
        "unknownTargetCases": unknown_ids,
        "unknownReturnedAsNonemptyEnglish": sum(isinstance(item["rawTarget"], dict) and isinstance(item["rawTarget"].get("object_en"), str) and bool(item["rawTarget"]["object_en"].strip()) for item in unknown_raw),
        "unknownRawDiagnostics": unknown_raw,
        "firstSchemaErrors": dict(Counter(row["schemaError"] for row in rows if row["schemaError"])),
        "latencyMs": {"median": statistics.median(latencies), "min": min(latencies), "max": max(latencies), "total": sum(latencies)},
        "scoringCaveat": "The frozen contract is unchanged. new-sphere requires explicit count=1 even though the default would give the intended final shape. Raw diagnostics do not imply accepted execution or semantic correctness.",
        "evaluationReuse": "The same 24 v1 artificial cases were reused. This is a controlled model comparison, not fresh held-out evaluation.",
    }
    with (HERE/(args.run+"-summary.json")).open("x") as out:
        json.dump(report, out, ensure_ascii=False, indent=2)
        out.write("\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

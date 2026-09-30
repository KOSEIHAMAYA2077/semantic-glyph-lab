"""Run only predeclared artificial cases; never use arbitrary user text here."""
import argparse
import hashlib
import json
from pathlib import Path
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", default="run-01")
    args = parser.parse_args()
    if not args.run.replace("-", "").isalnum(): raise SystemExit("Invalid run name")
    plan_path = Path(__file__).with_name("evaluation-plan.json")
    plan = json.loads(plan_path.read_text())
    destination = Path(__file__).with_name(args.run + ".jsonl")
    if destination.exists(): raise SystemExit("Existing observations must be preserved")
    with destination.open("x") as output:
        for case in plan["cases"]:
            started = time.perf_counter()
            request = Request("http://127.0.0.1:4185/describe", data=json.dumps({"text":case["text"]}).encode(), headers={"Content-Type":"application/json","Origin":"http://127.0.0.1:4183"})
            try: response = urlopen(request,timeout=90)
            except HTTPError as error: response = error
            result = json.loads(response.read())
            row = {**case,"status":response.status,"httpWallMs":round((time.perf_counter()-started)*1000),"result":result,"planSHA256":hashlib.sha256(plan_path.read_bytes()).hexdigest()}
            output.write(json.dumps(row,ensure_ascii=False) + "\n"); output.flush()
            print(case["id"],row["status"],row["httpWallMs"],flush=True)


if __name__ == "__main__": main()

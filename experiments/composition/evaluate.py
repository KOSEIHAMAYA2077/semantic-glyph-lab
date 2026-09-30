"""Run artificial composition prompts; never reads user documents or drafts."""
import argparse
import json
from pathlib import Path
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError

CASES = [
    ("development", "三つの輪をまとった剣"),
    ("development", "背もたれがハートの椅子"),
    ("development", "四角い花瓶"),
    ("held-out", "二つの車輪と細いフレームからなる自転車"),
    ("held-out", "傘をさしている雪だるま"),
    ("held-out", "輪の上に浮かぶ小さな灯台"),
]
FRESH_CASES = [
    ("fresh-composition", "花瓶から大きな木が生えている"),
    ("fresh-composition", "大きな輪の内側に小さな家が浮いている"),
    ("fresh-composition", "魚の左右に星形の翼がある"),
    ("fresh-composition", "キノコの傘を屋根にした細長い塔"),
    ("fresh-composition", "四角くねじれた貝"),
    ("fresh-composition", "丸い頭と四角い胴体、左右の腕と二本の脚をもつロボット"),
]

parser = argparse.ArgumentParser()
parser.add_argument("--output", type=Path, default=Path(__file__).with_name("run-01.jsonl"))
parser.add_argument("--port", type=int, default=4185)
parser.add_argument("--limit", type=int, default=len(CASES))
parser.add_argument("--comparison", action="store_true")
parser.add_argument("--fresh", action="store_true")
args = parser.parse_args()
if args.output.exists():
    raise SystemExit("Refusing to replace existing evaluation results")
with args.output.open("x") as file:
    selected = FRESH_CASES if args.fresh else CASES
    for split, text in selected[:max(1, min(len(selected), args.limit))]:
        start = time.perf_counter()
        request = Request(f"http://127.0.0.1:{args.port}/compose", data=json.dumps({"text": text}).encode(), headers={"Content-Type": "application/json"})
        try:
            response = urlopen(request, timeout=180)
        except HTTPError as error:
            response = error
        result = json.load(response)
        record = {"split": "reused-comparison" if args.comparison else split, "input": text, "status": response.status, "wallMs": round((time.perf_counter() - start) * 1000), "result": result}
        file.write(json.dumps(record, ensure_ascii=False) + "\n"); file.flush()
        print(json.dumps({"input": text, "status": response.status, "wallMs": record["wallMs"], "parts": len(result.get("parts", [])), "attempts": result.get("attempts")}, ensure_ascii=False), flush=True)

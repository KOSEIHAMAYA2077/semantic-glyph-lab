"""CPU-only validation of saved artificial descriptions with real CLIP tokens."""
import argparse
import hashlib
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(); parser.add_argument("run")
    args = parser.parse_args()
    if not args.run.replace("-", "").isalnum(): raise SystemExit("Invalid run name")
    import clip
    source = Path(__file__).with_name(args.run + ".jsonl")
    destination = Path(__file__).with_name(args.run + "-clip.json")
    if destination.exists(): raise SystemExit("Existing measurements must be preserved")
    rows = []
    for line in source.read_text().splitlines():
        item = json.loads(line)
        row = {"id":item["id"],"status":item["status"]}
        if item["status"] == 200:
            text = item["result"]["text_en"]
            try:
                tokens = clip.tokenize([text], context_length=77, truncate=False)[0].tolist()
                row.update(clipAccepted=True, clipTokens=max(i for i,n in enumerate(tokens) if n)+1, characters=len(text), words=len(text.split()))
            except (RuntimeError, ValueError): row.update(clipAccepted=False)
        rows.append(row)
    result = {"source":source.name,"sourceSHA256":hashlib.sha256(source.read_bytes()).hexdigest(),"tokenizer":"official openai/CLIP, context 77 including start/end, truncate=False; CPU only; no model weights", "cases":rows}
    with destination.open("x") as output: json.dump(result,output,indent=2);output.write("\n")
    print(json.dumps(result,indent=2))


if __name__ == "__main__": main()

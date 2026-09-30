"""Compare the explicit tied-weight compatibility load to the official loader."""
import json
from pathlib import Path
import time

from evaluate import load_model, MODEL_PATH, DIRECTORY


def main():
    destination=DIRECTORY/"loader-verification-v2.json"
    if destination.exists():raise SystemExit("Existing verification must be preserved")
    model,tokenizer,torch,metrics=load_model()
    from transformers import MarianMTModel
    official=MarianMTModel.from_pretrained(str(MODEL_PATH),local_files_only=True,use_safetensors=False,weights_only=True).to("cpu").eval()
    expected=model.state_dict();actual=official.state_dict()
    mismatches=[key for key in expected if key not in actual or not torch.equal(expected[key],actual[key])]
    rows=[json.loads(line) for line in (DIRECTORY/"run-01-cpu.jsonl").read_text().splitlines()]
    checks=[]
    for item in rows:
        if item["id"] not in {"nested-relations","negative-vase","asymmetric-fruit"}:continue
        inputs=tokenizer([item["text"]],return_tensors="pt",padding=True,truncation=False)
        with torch.inference_mode():tokens=official.generate(**inputs,num_beams=6,max_new_tokens=128,do_sample=False,renormalize_logits=True,early_stopping=True)
        text=tokenizer.batch_decode(tokens,skip_special_tokens=True)[0]
        checks.append({"id":item["id"],"officialLoaderOutput":text,"identicalToExplicitLoader":text==item["text_en"]})
    result={"environment":".local/translation-model-venv-v2","purpose":"pip refreshed in separate environment; verify legacy shared-weight alias matches official loader and does not cause the observed lexical failures","modelLoad":metrics,"stateTensorCount":len(expected),"mismatchedKeys":mismatches,"outputs":checks}
    with destination.open("x") as output:json.dump(result,output,indent=2);output.write("\n")
    print(json.dumps(result,indent=2))
    if mismatches or not all(x["identicalToExplicitLoader"] for x in checks):raise SystemExit("Loader comparison failed")


if __name__=="__main__":main()

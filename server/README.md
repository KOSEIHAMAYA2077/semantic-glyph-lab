# Local meaning-to-form service

The independent prototype maps Japanese/English text to one of 24 authored form IDs, then applies bounded attributes. The learned part is multilingual sentence similarity against three Japanese descriptions per form. It does **not** generate arbitrary meshes or train a new 3D model. `mode: "rules"` provides a no-embedding baseline with the same attribute parser.

## Setup and run

Use a new environment inside this repository; existing application environments are not modified.

```sh
python3.12 -m venv .local/semantics-venv
.local/semantics-venv/bin/python -m pip install -r server/requirements.lock.txt
.local/semantics-venv/bin/python server/fetch_model.py
.local/semantics-venv/bin/python server/app.py
```

The service binds only to `127.0.0.1:4184`. Browser origins are restricted to `http://127.0.0.1:4183` and `http://localhost:4183`. A rules-only service can run without the model using `server/app.py --rules-only`. Python 3.12.14 and the lockfile were actually exercised on Apple M5/macOS; other operating systems are not yet verified.

`fetch_model.py` downloads the pinned official ONNX file and tokenizer/configuration files into `.local/semantics-model`. It checks the model SHA256 and retains any interrupted partial download. It does not overwrite existing files. The weights are not committed to Git. Model/runtime initialization and inference use local files only. They were tested with outgoing socket connections disabled using `verify_offline.py`.

## API

`GET /health` reports readiness, model revision, supported IDs, token limit, and current thresholds.

`POST /interpret` with `Content-Type: application/json`:

```json
{
  "text": "四角い花瓶",
  "previous": {
    "object": "sphere", "squareness": 0, "elongation": 1,
    "twist": 0, "bend": 0, "roughness": 0, "count": 1
  },
  "mode": "semantic"
}
```

The response implements `src/types.ts`'s `Interpretation`. The above example returns `spec.object: "vase"`, `spec.squareness: 1`, and `source: "composed"`. `腰を下ろして休めるもの` returns `chair` through embedding search. `長くねじれた剣` combines `sword`, `elongation: 1.8`, and `twist: 0.65`.

- A recognized explicit object name takes priority. Longer overlapping words win (`花瓶` over `花` or `瓶`); when several separate names remain, the last occurrence wins.
- Otherwise, semantic mode compares against 72 fixed captions. Each object's highest caption cosine similarity is its score. Accept only if top score is at least 0.48 and exceeds the runner-up by at least 0.035. These are engineering thresholds, not calibrated probabilities.
- Attributes and optional text color are parsed separately. Attribute/color-only instructions preserve the previous object and other parameters. A newly selected object begins with neutral attributes before the current modifiers are applied.
- If object retrieval is uncertain, retain the current object. Explicit attributes may still change it; such a result has `source: "composed"` and an uncertainty note.
- Inputs are limited to 4,000 Unicode characters. The embedding model uses at most the **last 128 tokens**; earlier object names still participate in the explicit rule pass. This intentionally favors recent wording and does not understand a whole long manuscript.
- `candidates` contains up to five objects and cosine scores (explicit names return one candidate with score 1). `elapsedMs` measures interpretation inside Python, not HTTP transport or initial model load.
- Text is processed in memory only. There is no request/body log, persistent input history, remote inference call, model-generated code, `eval`, or `trust_remote_code`. Authored test fixtures are synthetic and explicitly saved.

## Validation

```sh
.local/semantics-venv/bin/python server/test_interpreter.py -v
.local/semantics-venv/bin/python server/test_api.py -v
.local/semantics-venv/bin/python server/verify_offline.py
.local/semantics-venv/bin/python server/evaluate.py --output experiments/semantics/my-new-run.json
```

Evaluation refuses to overwrite an earlier report. Keep development questions separate from the frozen fixture. The first held-out run and later regression replay are deliberately distinct; see [experiment report](../experiments/semantics/REPORT.md).

## Model and limitations

Official model: [Sentence Transformers multilingual MiniLM](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2), Apache-2.0. Fixed revision `e8f8c211226b894fcb81acc59f3b34ba3efd5f42`; official `onnx/model_qint8_arm64.onnx`, CPU inference with two intra-op threads. Japanese is included in its [50+ supported languages](https://www.sbert.net/docs/sentence_transformer/pretrained_models.html). Mean pooling and normalization follow the supplied Sentence Transformers configuration. Every fetched file's source URL, byte size, and SHA256 is recorded in [model-manifest.json](../experiments/semantics/model-manifest.json).

There are only 24 candidate objects. A finite description catalog cannot cover arbitrary nouns, subtle metaphor, negation, or every sentence. Short kana aliases need conservative boundaries; long kana prose falls through to learned search. `五つの角` can currently be interpreted as five instances instead of an object's five corners. Related forms (ring/knot, star/cube) can cause a confident-looking top score but small margin, correctly triggering abstention under the current policy. The attribute parser is a rule system, not a learned language parser. The HTTP server is a local research service, not a production multiuser deployment.

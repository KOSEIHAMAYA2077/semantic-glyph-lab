# Semantic retrieval experiment, 2026-09-30

## Implemented and measured

The service is separate from the earlier art application. An official pretrained multilingual sentence encoder chooses among 24 form IDs; a bounded parser applies squareness, elongation, twist, bend, roughness, count, and optional text color. The original application and environments were not changed.

On Apple M5/32GB, ONNX Runtime CPU inference (two intra-op threads) successfully ran Japanese text locally. A cold observed model/catalog initialization took 1.87 seconds; subsequent runs with warm filesystem cache took 0.60–0.65 seconds. These are process initialization times, not model download times. `POST /interpret` and allowed-origin CORS were exercised at `127.0.0.1:4184`. Model loading and real inference also passed while outgoing socket connections were patched to raise, with zero attempted outgoing connections.

## Frozen evaluation versus rule baseline

`dev.json` records the nine initial exploratory examples. `heldout-v1.json` contains a separate artificial 52-question evaluation, authored and SHA256-frozen before its first run; it is not an externally supplied benchmark and should not be treated as a population accuracy estimate. `freeze-v1.json` fixes the fixture, catalog, and interpreter hashes. No description or acceptance threshold was tuned against its results.

| Category | Rule baseline, first run | Semantic + rules, first run |
|---|---:|---:|
| Object paraphrases | 1/24 | 21/24 |
| Object plus attributes/color | 10/10 | 10/10 |
| Attribute-only context preservation | 8/8 | 8/8 |
| Unsupported input keeps current form | 10/10 | 10/10 |

First-run evidence: [results-v1.json](results-v1.json). Semantic interpretation across the 52 cases had median 2.12 ms, p95 3.17 ms, max 3.50 ms in Python, excluding model initialization and HTTP/browser costs. The rule baseline median was 0.15 ms; its first request included regex initialization overhead (24.12 ms).

Three first-run paraphrase failures were retained:

1. `持ち歩くもの` accidentally contained the kana alias `くも`, yielding cloud instead of bottle. This exposed a substring-matching bug, not a poor embedding.
2. The ring description ranked ring 0.85242 and knot 0.84416. The margin was too small, so the current object was retained.
3. The star description ranked star 0.72215 and cube 0.71046. It was also rejected for insufficient margin; `五つの角` additionally triggered instance count 5, a known parser limitation.

The short-kana alias boundary bug was fixed generically and given unit regressions (`ひとり`, `ではない`, and `歩くもの` must not trigger unrelated nouns). The later [regression replay](regression-v1-kana-boundary.json) reached **22/24** paraphrases; the other groups remained unchanged. This replay is **not fresh held-out accuracy** because a bug revealed by the first run was corrected. The two ambiguity cases were not used to tune thresholds or catalog descriptions. A new unseen fixture is needed for any subsequent model/policy comparison.

## Checks

- 18 standard-library unit and HTTP tests pass: noun/attribute separation, longer overlapping nouns, modifier-only context, kana/kanji boundaries, low-confidence abstention, counts and bounds, no-model baseline, input validation, origin allowlist, preflight, DNS-rebinding Host rejection, no-store responses.
- Real model initialized and inferred `腰を下ろして休めるもの` → chair with all outgoing socket connects denied.
- Live HTTP requests returned vase+squareness, sword+twist+elongation, and paraphrased chair in the shared `Interpretation` format.
- This sub-experiment has no browser drawing; surface coverage and art quality are evaluated by the common renderer owner.

## Download and provenance

The exact source is the official [Sentence Transformers model repository](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2), revision `e8f8c211226b894fcb81acc59f3b34ba3efd5f42`, Apache-2.0. The selected ARM64 int8 ONNX weighs **118,412,398 bytes**, SHA256 `783fea82d71a58179b830a4dbd2d58447e640609e98eedf9ffa12622d375a672`. Tokenizer and metadata bring model-related files to **127,499,457 bytes**. No training dataset was downloaded and no new model was trained. The model directory is private to this experiment and excluded from Git; source code, synthetic evaluation, and hashes can be published.

The [full manifest](model-manifest.json) records each artifact. [Pinned environment packages](../../server/requirements.lock.txt) reproduce the observed dependency set. No remote Python source, pickle checkpoint, or `trust_remote_code` is needed by this ONNX path. Supporting packages are installed only in this repository's dedicated venv.

## What remains

The result demonstrates a small learned semantic retrieval path beyond exact keyword lookup. It does not establish arbitrary text-to-3D generation. Next useful independent comparisons are attribute extraction by a constrained local language model, a fresh paraphrase fixture with distractor clauses/negation, and more varied or independently annotated mesh captions. Adding hundreds of near-duplicate catalog descriptions solely to pass this frozen set would not be a valid improvement.

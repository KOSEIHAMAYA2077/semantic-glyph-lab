# Shap-E on Apple Silicon

Text-to-mesh baseline for Semantic Glyph Lab. All prompts are synthetic English examples. Neither user writing nor images are sent to an inference service.

## Scope

- Dedicated Python environment under `.local/shap-e-venv`; no global package changes.
- Official Shap-E source pinned to `50131012ee11c9d2617f3886c10f000d3c7a3b43` and official CLIP source pinned to `d05afc436d78f1c48dc0dbf8e5980a9d471f35f6`.
- Only inference weights needed for text generation and decoding; no training dataset, Blender, encoder, or image generation model.
- The source checkouts, model weights and virtual environment stay out of public Git. `downloads.json` records URLs, byte counts and verified upstream SHA256 values.
- Public meshes contain generated geometry from artificial prompts. A manifest records the prompt, seed, inference parameters, timing, topology and asset checksum.

## Weight loading

Shap-E checkpoints are loaded with explicit `weights_only=True`, then checked to be dictionaries containing tensors only. Model definitions come from the inspected official source, and YAML is parsed with `safe_load`.

CLIP's official release is a TorchScript archive, so it cannot be represented as a `weights_only=True` load. Its exact upstream SHA256 is verified before `torch.jit.load`; only its state dictionary is transferred into CLIP's inspected eager Python architecture. The archived forward graph is not used for inference. This is a provenance-based trust decision for a pinned official artifact, not a claim that every arbitrary TorchScript archive is safe.

The runner does not execute remote model code or accept arbitrary weight URLs. Downloads use exclusive file creation; an incomplete or mismatched existing file is preserved and reported instead of silently replacing it.

## Baseline extraction

The first run uses a batch size of 1, 32 Karras steps, guidance 15, float32 sampling and a 64³ signed-distance grid. The official decoder predicts signed distances; CPU marching cubes from scikit-image turns the field into a mesh. The negative border follows Shap-E's official surface extraction convention. Geometry is exported from Z-up to Y-up as GLB and loaded again to verify serialization.

This is intentionally a coarse baseline, not the official high-quality renderer. It omits generated RGB texture because the shared viewer adds flowing glyphs instead. Geometry timing excludes the initial weight download; cold model load is reported separately. Process RSS and observed MPS driver allocation are different metrics, so neither is described as total system peak memory.

## Reproduce

From the repository root, after creating a dedicated environment and installing the pinned dependencies:

```sh
.local/shap-e-venv/bin/python experiments/shap-e/fetch_models.py
.local/shap-e-venv/bin/python experiments/shap-e/generate.py --device mps --steps 32 --grid 64 --run mps32-grid64
```

A run name must be new. Existing meshes and experiment directories are not overwritten. `--device cpu` provides a distinct fallback experiment; it is not automatically substituted while timing a purported MPS run.

## Sources

- [Shap-E official source and MIT license](https://github.com/openai/shap-e)
- [Shap-E paper](https://arxiv.org/abs/2305.02463)
- [Official model download URLs and hashes](https://github.com/openai/shap-e/blob/main/shap_e/models/download.py)
- [Official CLIP source and MIT license](https://github.com/openai/CLIP)
- [Official CLIP model URLs and hashes](https://github.com/openai/CLIP/blob/main/clip/clip.py)

Measurements and inspection results are appended as separate experiment records, including failures. This work does not establish that every word or sentence can be faithfully turned into a 3D object.

## Measured result

See [RESULTS.md](RESULTS.md). The initial unpatched MPS run failed on float64 transfer; `mps_compat.py` preserves the upstream float32 output while moving the cast before the device transfer. The fixed run generated all five artificial examples in about 39–40 seconds each. `public/generated/manifest.json` exposes both 64³ and 128³ meshes to the shared viewer. Raw errors and tensor latents remain local; public records contain sanitized error messages and artifact metadata.

```sh
.local/shap-e-venv/bin/python experiments/shap-e/refine_meshes.py mps32-grid64-fixed --grid 128 --run another-new-run-name
.local/shap-e-venv/bin/python experiments/shap-e/render_comparison.py another-new-run-name
```

The four `outer-shell-v1` assets are explicit display derivatives, not replacements. They retain the largest-area closed positive-volume component of each single-object example. This removes cavity shells in the sphere/cube and small detached pieces in the sword/vase; it must not be blindly applied to multi-part models. `extract_outer_shells.py` preserves the previous public manifest and every original mesh.

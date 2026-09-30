# Setup record

2026-09-30. New dedicated environment only; existing TripoSR/Shap-E environments are unchanged.

1. Initial requested combination `diffusers==0.40.0` and `transformers==4.46.3` failed dependency resolution before installation. The former requires `huggingface-hub>=1.23.0,<2.0`; the latter requires `<1.0,>=0.23.2`. This is a dependency conflict, not an inference failure. The empty environment was retained.
2. Use the older, compatible SDXL-capable `diffusers==0.32.2` with `transformers==4.46.3`, instead of forcing incompatible dependencies or changing existing environments. Record the complete resolved environment after installation.

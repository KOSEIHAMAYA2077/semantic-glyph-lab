"""Local Qwen -> validated primitive parts. No generated code is executed."""
from __future__ import annotations

import argparse
import json
import math
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
MODEL_ID = "Qwen/Qwen3-4B-MLX-4bit"
MODEL_REVISION = "52a5ab34fa604bc8af6d3ce0cac0cab10b7eb495"
INSTRUCT_MODEL_ID = "Qwen/Qwen3-4B-Instruct-2507"
INSTRUCT_MODEL_REVISION = "cdbee75f17c01a7cc42f958dc650907174af0554"
MAX_TEXT = 2000
MAX_BODY = 16384
KINDS = {"box", "sphere", "cylinder", "cone", "torus"}
FORMS = {"sphere", "cube", "vase", "sword", "tree", "flower", "fish", "bird", "chair", "table", "mug", "bottle", "house", "tower", "ring", "star", "heart", "knot", "shell", "cone", "pyramid", "rock", "cloud", "mushroom"}
DEFORMATION_BOUNDS = {"squareness": (0, 1), "elongation": (.5, 2.5), "twist": (-1, 1), "bend": (-1, 1), "roughness": (0, 1)}
ALLOWED_ORIGINS = {"http://127.0.0.1:4183", "http://localhost:4183"}


class CompositionError(ValueError):
    pass


class NoVisualSubjectError(CompositionError):
    pass


def parse_description(text: str) -> dict[str, str]:
    """Only a bounded English description, never a generated program or recipe."""
    try:
        value = json.loads(text)
    except (ValueError, TypeError, OverflowError):
        raise CompositionError("Description must be one plain JSON object") from None
    if type(value) is not dict or set(value) != {"text_en"} or type(value["text_en"]) is not str:
        raise CompositionError("Description must contain only text_en")
    description = value["text_en"].strip()
    if not description:
        raise NoVisualSubjectError("No concrete visual subject was identified")
    if len(description) > 300 or any(not 32 <= ord(c) <= 126 for c in description):
        raise CompositionError("Description must be 1 to 300 printable ASCII characters")
    if not any("a" <= c.lower() <= "z" for c in description):
        raise CompositionError("Description must contain English words")
    return {"text_en": description}


def validate_composition(value: Any, vocabulary: str = "primitives") -> dict[str, Any]:
    """Reject, rather than execute or silently clamp, any unsupported structure."""
    if type(value) is not dict or set(value) != {"label", "parts"}:
        raise CompositionError("Expected only label and parts")
    label = value["label"]
    if not isinstance(label, str) or not 1 <= len(label) <= 80 or any(ord(c) < 32 for c in label):
        raise CompositionError("Label must be 1 to 80 printable characters")
    parts = value["parts"]
    if type(parts) is not list or not 1 <= len(parts) <= 24:
        raise CompositionError("Expected 1 to 24 parts")
    result = []
    allowed_kinds = KINDS | FORMS if vocabulary == "forms" else KINDS
    for part in parts:
        core = {"kind", "position", "scale", "rotation"}
        if type(part) is not dict or not core <= set(part) or set(part) - core - ({"deformation"} if vocabulary == "forms" else set()):
            raise CompositionError("Unsupported part fields")
        if type(part["kind"]) is not str or part["kind"] not in allowed_kinds:
            raise CompositionError("Unsupported primitive kind")
        clean = {"kind": part["kind"]}
        for key, lo, hi in [("position", -5, 5), ("scale", .03, 4), ("rotation", -math.pi, math.pi)]:
            vector = part[key]
            if type(vector) is not list or len(vector) != 3:
                raise CompositionError(f"{key} must contain three numbers")
            if any(type(n) not in (int, float) or not math.isfinite(n) or n < lo or n > hi for n in vector):
                raise CompositionError(f"{key} is outside its numeric bounds")
            clean[key] = [float(n) for n in vector]
        if "deformation" in part:
            deformation = part["deformation"]
            if part["kind"] not in FORMS or type(deformation) is not dict or set(deformation) - set(DEFORMATION_BOUNDS):
                raise CompositionError("Unsupported deformation fields")
            clean["deformation"] = {}
            for key, n in deformation.items():
                lo, hi = DEFORMATION_BOUNDS[key]
                if type(n) not in (int, float) or not math.isfinite(n) or n < lo or n > hi:
                    raise CompositionError("Deformation outside numeric bounds")
                clean["deformation"][key] = float(n)
        result.append(clean)
    return {"label": label, "parts": result}


def parse_generated(text: str, vocabulary: str = "primitives") -> dict[str, Any]:
    """Accept JSON only; no Python/JS evaluation, repairs or markdown extraction."""
    try:
        value = json.loads(text)
    except (ValueError, TypeError, OverflowError) as exc:
        raise CompositionError("Model output was not a plain JSON object") from exc
    return validate_composition(value, vocabulary)


class Composer:
    def __init__(self, model_path: Path, max_tokens: int = 3072, variant: str = "base", temperature: float = .7, vocabulary: str = "primitives"):
        # The explicit local model path and offline flags prohibit lazy remote code
        # or network-backed inference. Download is a separate audited preparation step.
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
        os.environ["HF_HOME"] = str(ROOT / ".local/composition-cache/huggingface")
        if not model_path.is_dir():
            raise RuntimeError("Local composition weights have not been prepared")
        import mlx.core as mx
        from mlx_lm import load
        from mlx_lm.sample_utils import make_sampler
        self.mx = mx
        mx.random.seed(17)
        self.model_id = INSTRUCT_MODEL_ID if variant == "instruct" else MODEL_ID
        self.revision = INSTRUCT_MODEL_REVISION if variant == "instruct" else MODEL_REVISION
        self.model, self.tokenizer = load(str(model_path), tokenizer_config={"trust_remote_code": False})
        self.sampler = make_sampler(temp=temperature, top_p=.8, top_k=20)
        self.description_sampler = make_sampler(temp=0)
        self.max_tokens = max_tokens
        self.vocabulary = vocabulary
        prompt_file = "composition-forms-prompt.txt" if vocabulary == "forms" else "composition-prompt.txt"
        self.prompt = (Path(__file__).with_name(prompt_file)).read_text()
        self.description_prompt = Path(__file__).with_name("composition-description-prompt.txt").read_text()
        self.lock = threading.Lock()

    def compose(self, text: str) -> dict[str, Any]:
        if not self.lock.acquire(blocking=False):
            raise BlockingIOError("Composition is busy")
        try:
            from mlx_lm import generate
            started = time.perf_counter()
            messages = [{"role": "system", "content": self.prompt}, {"role": "user", "content": text}]
            last_error = None
            for attempt in range(2):
                prompt = self.tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
                output = generate(self.model, self.tokenizer, prompt=prompt, max_tokens=self.max_tokens, sampler=self.sampler, verbose=False)
                try:
                    result = parse_generated(output, self.vocabulary)
                    result.update(elapsedMs=round((time.perf_counter() - started) * 1000), model=self.model_id, attempts=attempt + 1, peakMemoryBytes=int(self.mx.get_peak_memory()), vocabulary=self.vocabulary)
                    return result
                except CompositionError as exc:
                    last_error = exc
                    # One bounded re-generation, not a handwritten fallback recipe.
                    messages.append({"role": "assistant", "content": output})
                    messages.append({"role": "user", "content": f"Validation error: {exc}. Return the sculpture again as valid JSON only. Use only the exact fields and numeric limits in the system schema. Omit optional deformation fields that are not requested. Reduce to at most 12 simple parts."})
            raise last_error or CompositionError("Invalid composition")
        finally:
            self.mx.clear_cache()
            self.lock.release()


    def describe(self, text: str) -> dict[str, Any]:
        """Share the model and lock with composition; keep this route independent."""
        if not self.lock.acquire(blocking=False):
            raise BlockingIOError("Composition is busy")
        try:
            from mlx_lm import generate
            started = time.perf_counter()
            messages = [{"role": "system", "content": self.description_prompt}, {"role": "user", "content": text}]
            last_error = None
            for attempt in range(2):
                prompt = self.tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
                output = generate(self.model, self.tokenizer, prompt=prompt, max_tokens=512, sampler=self.description_sampler, verbose=False)
                try:
                    result = parse_description(output)
                    result.update(elapsedMs=round((time.perf_counter() - started) * 1000), model=self.model_id, attempts=attempt + 1)
                    return result
                except NoVisualSubjectError:
                    # Do not turn a deliberate abstention into a made-up object.
                    raise
                except CompositionError as exc:
                    last_error = exc
                    messages.append({"role": "assistant", "content": output})
                    messages.append({"role": "user", "content": f"Format error: {exc}. Return only the required JSON with text_en. Keep the original concrete meaning, within 300 ASCII characters and 45 words. If there is no concrete subject, use an empty string."})
            raise last_error or CompositionError("Invalid description")
        finally:
            self.mx.clear_cache()
            self.lock.release()


def make_handler(composer: Composer, port: int):
    class Handler(BaseHTTPRequestHandler):
        server_version = "LocalComposition/0.1"

        def log_message(self, _format, *args):
            pass  # No request path, prompt, model text, or user data in access logs.

        def setup(self):
            super().setup()
            self.connection.settimeout(10)

        def allowed(self) -> bool:
            host = self.headers.get("Host", "")
            origin = self.headers.get("Origin")
            return host in {f"127.0.0.1:{port}", f"localhost:{port}"} and (origin is None or origin in ALLOWED_ORIGINS)

        def reply(self, status: int, data: dict[str, Any]):
            body = json.dumps(data, ensure_ascii=False, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            origin = self.headers.get("Origin")
            if origin in ALLOWED_ORIGINS:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            if not self.allowed():
                return self.reply(403, {"error": "Origin or Host is not allowed"})
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", "http://127.0.0.1:4183"))
            self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Max-Age", "600")
            self.end_headers()

        def do_GET(self):
            if not self.allowed():
                return self.reply(403, {"error": "Origin or Host is not allowed"})
            if self.path != "/health":
                return self.reply(404, {"error": "Not found"})
            return self.reply(200, {"ok": True, "model": getattr(composer, "model_id", MODEL_ID), "revision": getattr(composer, "revision", MODEL_REVISION), "vocabulary": getattr(composer, "vocabulary", "primitives"), "local": True, "capabilities": ["compose", "describe"]})

        def do_POST(self):
            if not self.allowed():
                return self.reply(403, {"error": "Origin or Host is not allowed"})
            if self.path not in {"/compose", "/describe"}:
                return self.reply(404, {"error": "Not found"})
            if self.headers.get("Content-Type", "").split(";", 1)[0].strip() != "application/json":
                return self.reply(415, {"error": "Content-Type must be application/json"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > MAX_BODY:
                    return self.reply(413, {"error": "Request body size is outside limits"})
                data = json.loads(self.rfile.read(length))
                if type(data) is not dict or set(data) != {"text"} or not isinstance(data["text"], str):
                    return self.reply(400, {"error": "Expected text string"})
                text = data["text"].strip()
                if not 1 <= len(text) <= MAX_TEXT:
                    return self.reply(400, {"error": "Text must have 1 to 2000 characters"})
            except (ValueError, UnicodeDecodeError, TimeoutError):
                return self.reply(400, {"error": "Invalid request JSON"})
            try:
                operation = composer.describe if self.path == "/describe" else composer.compose
                return self.reply(200, operation(text))
            except BlockingIOError:
                return self.reply(503, {"error": "Composition is busy; try again after the current request"})
            except NoVisualSubjectError:
                return self.reply(422, {"error": "No concrete visual subject was identified"})
            except CompositionError:
                return self.reply(422, {"error": "The model did not produce a valid description" if self.path == "/describe" else "The model did not produce a valid composition"})
            except Exception:
                return self.reply(500, {"error": "Local composition failed"})

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=4185)
    parser.add_argument("--model", type=Path)
    parser.add_argument("--max-tokens", type=int, default=3072)
    parser.add_argument("--variant", choices=["base", "instruct"], default="instruct")
    parser.add_argument("--temperature", type=float, default=.7)
    parser.add_argument("--vocabulary", choices=["primitives", "forms"], default="forms")
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535 or not 256 <= args.max_tokens <= 4096 or not 0 <= args.temperature <= 1:
        parser.error("Port or generation bound outside limits")
    model_path = args.model or ROOT / (".local/composition-instruct-4bit" if args.variant == "instruct" else ".local/composition-model")
    composer = Composer(model_path.resolve(), args.max_tokens, args.variant, args.temperature, args.vocabulary)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(composer, args.port))
    print(f"Composition ready at http://127.0.0.1:{args.port}; local model loaded; input logging disabled", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()

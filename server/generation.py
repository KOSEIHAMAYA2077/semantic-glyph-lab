"""Bounded local Shap-E service. Requests and generated meshes stay in memory."""
from __future__ import annotations

import argparse
import contextlib
import importlib.util
import io
import json
import math
import multiprocessing
import signal
import struct
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
MODEL = "openai/shap-e:text300M"
REVISION = "50131012ee11c9d2617f3886c10f000d3c7a3b43"
MAX_BODY = 4096
MAX_TEXT = 300
MAX_GLB = 24 * 1024 * 1024
STEPS = 32
GRID = 128
SEED = 20260930
ORIGINS = {"http://127.0.0.1:4183", "http://localhost:4183"}


class RequestError(ValueError):
    pass


class GenerationError(RuntimeError):
    pass


def validate_text(data: Any, tokenize=None) -> tuple[str, int]:
    if type(data) is not dict or set(data) != {"text"} or not isinstance(data["text"], str):
        raise RequestError("Expected one text string")
    text = data["text"].strip()
    if not 1 <= len(text) <= MAX_TEXT:
        raise RequestError("Use 1 to 300 characters of English text")
    if any(ord(c) > 126 or (ord(c) < 32 and c not in "\n\t") for c in text):
        raise RequestError("This experiment accepts basic English/ASCII text only")
    if not any("a" <= c.lower() <= "z" for c in text):
        raise RequestError("Describe an object using English words")
    if tokenize is None:
        import clip
        tokenize = clip.tokenize
    try:
        tokens = tokenize([text], context_length=77, truncate=False)
    except (RuntimeError, ValueError):
        # Upstream's exception embeds the prompt. Replace it before it can reach
        # a response or log. The model's own silent truncate=True is pre-empted.
        raise RequestError("Prompt exceeds CLIP's 77-token limit including start/end tokens") from None
    # The final nonzero token is EOT; punctuation can itself have token ID zero.
    row = tokens[0].tolist() if hasattr(tokens[0], "tolist") else list(tokens[0])
    occupied = [i for i, token in enumerate(row) if token != 0]
    return text, (occupied[-1] + 1 if occupied else 0)


def validate_glb(data: Any):
    if type(data) is not bytes or not 20 <= len(data) <= MAX_GLB:
        raise GenerationError("Generated mesh size is outside limits")
    magic, version, length = struct.unpack_from("<4sII", data)
    if magic != b"glTF" or version != 2 or length != len(data):
        raise GenerationError("Invalid GLB header")


def _worker(connection):
    """Owns MPS in a spawned process, allowing hard cancellation on timeout."""
    try:
        import numpy as np
        import torch
        import trimesh
        import yaml

        experiment = ROOT / "experiments/shap-e"
        sys.path.insert(0, str(experiment))
        spec = importlib.util.spec_from_file_location("shap_e_baseline", experiment / "generate.py")
        baseline = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(baseline)
        baseline.checked_files()  # All six pinned files checked before deserialization.
        baseline.configure_clip()
        from mps_compat import enable
        from shap_e.diffusion.sample import sample_latents
        from shap_e.diffusion.gaussian_diffusion import diffusion_from_config

        if not torch.backends.mps.is_available():
            raise GenerationError("MPS is unavailable on this machine")
        enable()
        device = torch.device("mps")
        torch.set_num_threads(6)
        started = time.perf_counter()
        model = baseline.load_model("text300M", device)
        decoder = baseline.load_model("decoder", device)
        diffusion = diffusion_from_config(yaml.safe_load((baseline.CACHE / "diffusion_config.yaml").read_text()))
        baseline.synchronize(device)
        connection.send({"ready": True, "loadMs": round((time.perf_counter() - started) * 1000)})

        while True:
            request = connection.recv()
            if request is None:
                break
            started = time.perf_counter()
            try:
                text = request["text"]
                torch.manual_seed(SEED)
                np.random.seed(SEED)
                with torch.no_grad():
                    latents = sample_latents(
                        batch_size=1, model=model, diffusion=diffusion,
                        guidance_scale=15., model_kwargs={"texts": [text]},
                        progress=False, clip_denoised=True, use_fp16=False,
                        use_karras=True, karras_steps=STEPS, sigma_min=1e-3,
                        sigma_max=160, s_churn=0, device=device,
                    )
                baseline.synchronize(device)
                sample_ms = round((time.perf_counter() - started) * 1000)
                if not torch.isfinite(latents).all():
                    raise GenerationError("Non-finite latent")
                # The reused decoder emits numeric progress, not user input.
                # Silence it in this service while leaving the research runner intact.
                with contextlib.redirect_stdout(io.StringIO()):
                    mesh, _ = baseline.extract(decoder, latents[0], GRID, 8192)
                baseline.synchronize(device)
                if not 4 <= len(mesh.faces) <= 400000 or len(mesh.vertices) > 250000:
                    raise GenerationError("Mesh complexity outside limits")
                if not np.isfinite(mesh.vertices).all() or np.max(np.abs(mesh.vertices)) > 5:
                    raise GenerationError("Mesh coordinates outside limits")
                data = mesh.export(file_type="glb")
                validate_glb(data)
                recovered = trimesh.load(io.BytesIO(data), file_type="glb", force="mesh", process=False)
                if len(recovered.faces) != len(mesh.faces) or not np.isfinite(recovered.vertices).all():
                    raise GenerationError("GLB round-trip failed")
                result = {
                    "data": data, "elapsedMs": round((time.perf_counter() - started) * 1000),
                    "sampleMs": sample_ms, "vertices": len(mesh.vertices), "faces": len(mesh.faces),
                    "seed": SEED, "steps": STEPS, "grid": GRID,
                }
                connection.send(result)
                del request, text, latents, mesh, recovered, data, result
                torch.mps.empty_cache()
            except Exception:
                # Deliberately exclude exception text: upstream errors may quote
                # the prompt or private paths. No input/output files are written.
                connection.send({"error": "Local mesh generation failed"})
    except (EOFError, BrokenPipeError):
        pass
    except Exception:
        try:
            connection.send({"startupError": "Model verification or MPS startup failed"})
        except (EOFError, BrokenPipeError):
            pass
    finally:
        connection.close()


class Generator:
    def __init__(self, timeout: float = 120, startup_timeout: float = 90, worker_target=_worker):
        self.timeout = timeout
        self.startup_timeout = startup_timeout
        self.worker_target = worker_target
        self.lock = threading.Lock()
        self.process = None
        self.connection = None
        self.load_ms = None
        self._start(startup_timeout)

    def _start(self, timeout):
        self.close()
        context = multiprocessing.get_context("spawn")
        parent, child = context.Pipe()
        self.process = context.Process(target=self.worker_target, args=(child,), daemon=True)
        self.connection = parent
        self.process.start()
        child.close()
        try:
            if not parent.poll(timeout):
                raise TimeoutError("Model startup timed out")
            message = parent.recv()
            if not message.get("ready"):
                raise GenerationError("Model verification or startup failed")
            self.load_ms = message.get("loadMs")
        except Exception:
            self.close()
            raise

    def ready(self):
        return self.process is not None and self.process.is_alive()

    def generate(self, text: str):
        if not self.lock.acquire(blocking=False):
            raise BlockingIOError("A generation is already running")
        started = time.perf_counter()
        try:
            if not self.ready():
                self._start(min(self.startup_timeout, self.timeout))
            self.connection.send({"text": text})
            remaining = self.timeout - (time.perf_counter() - started)
            if remaining <= 0 or not self.connection.poll(remaining):
                self.close()  # Terminates only this service's owned child worker.
                raise TimeoutError("Generation timed out; the local worker was stopped")
            result = self.connection.recv()
            if "error" in result or "startupError" in result:
                raise GenerationError("Local mesh generation failed")
            validate_glb(result.get("data"))
            return result
        except TimeoutError:
            raise
        except (EOFError, BrokenPipeError, OSError):
            self.close()
            raise GenerationError("Local worker stopped") from None
        finally:
            self.lock.release()

    def close(self):
        process = self.process
        self.process = None
        if process is not None:
            if process.is_alive():
                process.terminate(); process.join(2)
            if process.is_alive():
                process.kill(); process.join(2)
            process.close()
        if self.connection is not None:
            self.connection.close(); self.connection = None


def make_handler(generator, port: int, validator=validate_text):
    class Handler(BaseHTTPRequestHandler):
        server_version = "LocalGeneration/0.1"

        def log_message(self, _format, *args):
            pass

        def setup(self):
            super().setup(); self.connection.settimeout(10)

        def allowed(self):
            return self.headers.get("Host") in {f"127.0.0.1:{port}", f"localhost:{port}"} and self.headers.get("Origin") in ORIGINS | {None}

        def write_headers(self, status, kind, length):
            self.send_response(status)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(length))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            origin = self.headers.get("Origin")
            if origin in ORIGINS:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Access-Control-Expose-Headers", "X-Generation-Ms, X-Sample-Ms, X-Generation-Seed, X-CLIP-Tokens, X-Mesh-Faces")
                self.send_header("Vary", "Origin")

        def json_reply(self, status, value):
            data = json.dumps(value, allow_nan=False).encode()
            self.write_headers(status, "application/json; charset=utf-8", len(data)); self.end_headers()
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_OPTIONS(self):
            if not self.allowed():
                return self.json_reply(403, {"error": "Origin or Host is not allowed"})
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", "http://127.0.0.1:4183"))
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Max-Age", "600")
            self.end_headers()

        def do_GET(self):
            if not self.allowed():
                return self.json_reply(403, {"error": "Origin or Host is not allowed"})
            if self.path != "/health":
                return self.json_reply(404, {"error": "Not found"})
            self.json_reply(200, {"ok": generator.ready(), "busy": generator.lock.locked(), "model": MODEL, "revision": REVISION, "device": "mps", "steps": STEPS, "grid": GRID, "seed": SEED, "local": True, "maxCharacters": MAX_TEXT, "maxClipTokens": 77})

        def do_POST(self):
            if not self.allowed():
                return self.json_reply(403, {"error": "Origin or Host is not allowed"})
            if self.path != "/generate":
                return self.json_reply(404, {"error": "Not found"})
            if self.headers.get("Content-Type", "").split(";", 1)[0].strip() != "application/json":
                return self.json_reply(415, {"error": "Content-Type must be application/json"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= MAX_BODY:
                    return self.json_reply(413, {"error": "Request body exceeds limits"})
                text, tokens = validator(json.loads(self.rfile.read(length)))
            except RequestError as error:
                return self.json_reply(400, {"error": str(error)})
            except (ValueError, UnicodeDecodeError, TimeoutError):
                return self.json_reply(400, {"error": "Invalid request JSON"})
            try:
                result = generator.generate(text)
            except BlockingIOError:
                return self.json_reply(503, {"error": "A local generation is already running"})
            except TimeoutError:
                return self.json_reply(504, {"error": "Generation timed out; the local worker was stopped"})
            except GenerationError:
                return self.json_reply(500, {"error": "Local mesh generation failed"})
            data = result["data"]
            self.write_headers(200, "model/gltf-binary", len(data))
            self.send_header("X-Generation-Ms", str(result["elapsedMs"]))
            self.send_header("X-Sample-Ms", str(result.get("sampleMs", result["elapsedMs"])))
            self.send_header("X-Generation-Seed", str(result.get("seed", SEED)))
            self.send_header("X-CLIP-Tokens", str(tokens))
            self.send_header("X-Mesh-Faces", str(result.get("faces", 0)))
            self.end_headers()
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=4186)
    parser.add_argument("--timeout", type=float, default=120)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535 or not 30 <= args.timeout <= 180:
        parser.error("Port or timeout outside limits")
    generator = Generator(timeout=args.timeout)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(generator, args.port))
    def stop(_signum, _frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)
    print(f"Generation ready at http://127.0.0.1:{args.port}; MPS loaded; no input/output persistence", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close(); generator.close()


if __name__ == "__main__":
    main()

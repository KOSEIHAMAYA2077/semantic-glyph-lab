"""Loopback-only JSON API for the independent Semantic Glyph Lab."""
from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import time

from catalog import CATALOG
from fetch_model import MODEL_ID, REVISION
from interpreter import Embeddings, Interpreter, MAX_TEXT, MIN_MARGIN, MIN_SCORE

ORIGINS = {"http://127.0.0.1:4183", "http://localhost:4183"}
MAX_BODY = 32768


def handler_for(interpreter: Interpreter, load_ms: float, port: int = 4184):
    class Handler(BaseHTTPRequestHandler):
        server_version = "SemanticGlyph/0.1"

        def log_message(self, *_args):
            # No request URL, body, text or inferred object is written to disk/stdout.
            pass

        def allowed(self) -> bool:
            if self.headers.get("Host") not in {f"127.0.0.1:{port}", f"localhost:{port}"}:
                self.respond(403, {"error": "Loopback host required"}, cors=False)
                return False
            if self.headers.get("Origin") not in ORIGINS | {None}:
                self.respond(403, {"error": "Origin not allowed"}, cors=False)
                return False
            return True

        def respond(self, code: int, data: dict | None = None, cors: bool = True):
            body = json.dumps(data, ensure_ascii=False, allow_nan=False).encode() if data is not None else b""
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            if cors and self.headers.get("Origin") in ORIGINS:
                self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
                self.send_header("Vary", "Origin")
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            if not self.allowed():
                return
            if self.path not in ("/interpret", "/health"):
                return self.respond(404, {"error": "Not found"})
            self.send_response(204)
            if self.headers.get("Origin") in ORIGINS:
                self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
                self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self):
            if not self.allowed():
                return
            if self.path != "/health":
                return self.respond(404, {"error": "Not found"})
            self.respond(200, {"ok": True, "semanticReady": interpreter.embeddings is not None,
                "model": MODEL_ID, "revision": REVISION, "provider": "CPUExecutionProvider",
                "objects": list(CATALOG), "maxTextCharacters": MAX_TEXT,
                "maxTokens": 128, "modelLoadMs": round(load_ms, 2),
                "threshold": {"score": MIN_SCORE, "margin": MIN_MARGIN},
                "storesInput": False, "sendsInput": False})

        def do_POST(self):
            if not self.allowed():
                return
            if self.path != "/interpret":
                return self.respond(404, {"error": "Not found"})
            if self.headers.get_content_type() != "application/json":
                return self.respond(415, {"error": "Use application/json"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                return self.respond(400, {"error": "Invalid Content-Length"})
            if not 0 < length <= MAX_BODY:
                return self.respond(413, {"error": "Request too large or empty"})
            try:
                data = json.loads(self.rfile.read(length).decode("utf-8"),
                                  parse_constant=lambda _value: (_ for _ in ()).throw(ValueError("Nonfinite JSON")))
                if not isinstance(data, dict):
                    raise ValueError("JSON object required")
                result = interpreter.interpret(data.get("text"), data.get("previous"), data.get("mode", "semantic"))
            except (ValueError, UnicodeDecodeError) as error:
                # Validation messages contain no original body.
                return self.respond(400, {"error": str(error).split(": line")[0]})
            except Exception:
                return self.respond(500, {"error": "Local interpretation failed"})
            self.respond(200, result)
    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=4184)
    parser.add_argument("--rules-only", action="store_true")
    args = parser.parse_args()
    start = time.perf_counter()
    model = None if args.rules_only else Embeddings()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler_for(Interpreter(model),
                                (time.perf_counter() - start) * 1000, args.port))
    print(f"Semantic API ready at http://127.0.0.1:{args.port}; local CPU; no input logging", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

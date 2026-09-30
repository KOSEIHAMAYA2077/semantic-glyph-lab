"""Boundary/transport/worker timeout tests; no model weights loaded."""
import io
import json
import struct
import threading
import time
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer

import generation as api


def fake_tokenize(texts, context_length=77, truncate=False):
    if len(texts[0].split()) > 75:
        raise RuntimeError("An upstream error quoting private text")
    return [[49406] + [10] * len(texts[0].split()) + [49407] + [0] * (75 - len(texts[0].split()))]


def fake_glb():
    # A valid empty GLB is a transport fixture, not a generated sculpture.
    body = b'{"asset":{"version":"2.0"}}'
    body += b" " * (-len(body) % 4)
    return struct.pack("<4sII", b"glTF", 2, 20 + len(body)) + struct.pack("<I4s", len(body), b"JSON") + body


def slow_worker(connection):
    connection.send({"ready": True, "loadMs": 0})
    connection.recv()
    time.sleep(3)
    connection.send({"data": fake_glb(), "elapsedMs": 3000})


class BoundaryTests(unittest.TestCase):
    def test_english_and_token_limits(self):
        self.assertEqual(api.validate_text({"text": "a teapot"}, fake_tokenize), ("a teapot", 4))
        for value in [{"text": "球体"}, {"text": "1234"}, {"text": "x" * 301}, {"text": "x\x00"}, {"text": "a " * 76}, {"text": "a teapot", "code": "exec()"}]:
            with self.assertRaises(api.RequestError): api.validate_text(value, fake_tokenize)

    def test_real_clip_never_silently_truncates(self):
        text, tokens = api.validate_text({"text": "a ceramic teapot"})
        self.assertEqual(text, "a ceramic teapot"); self.assertLessEqual(tokens, 77)
        with self.assertRaises(api.RequestError) as error:
            api.validate_text({"text": "x " * 76})
        self.assertNotIn("x x", str(error.exception))

    def test_glb_header_and_size_checked(self):
        api.validate_glb(fake_glb())
        for data in [b"", b"not a mesh" * 4, fake_glb() + b"x", b"0" * (api.MAX_GLB + 1)]:
            with self.assertRaises(api.GenerationError): api.validate_glb(data)

    def test_worker_hard_timeout_and_lock_release(self):
        generator = api.Generator(timeout=.08, startup_timeout=5, worker_target=slow_worker)
        try:
            with self.assertRaises(TimeoutError): generator.generate("a cube")
            self.assertFalse(generator.ready())
            self.assertFalse(generator.lock.locked())
        finally:
            generator.close()

    def test_busy_worker_is_not_queued(self):
        generator = api.Generator(timeout=.08, startup_timeout=5, worker_target=slow_worker)
        try:
            generator.lock.acquire()
            with self.assertRaises(BlockingIOError): generator.generate("a cube")
            generator.lock.release()
        finally:
            generator.close()


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        class FakeGenerator:
            lock = threading.Lock()
            def ready(self): return True
            def generate(self, text):
                if text == "busy": raise BlockingIOError()
                if text == "timeout": raise TimeoutError()
                return {"data": fake_glb(), "elapsedMs": 7, "faces": 0}
        validator = lambda value: api.validate_text(value, fake_tokenize)
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), api.make_handler(FakeGenerator(), 0, validator))
        cls.port = cls.server.server_address[1]
        cls.server.RequestHandlerClass = api.make_handler(FakeGenerator(), cls.port, validator)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True); cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.thread.join()

    def request(self, value=None, path="/generate", headers=None, method=None):
        data = json.dumps(value).encode() if value is not None else None
        request = Request(f"http://127.0.0.1:{self.port}{path}", data=data, headers=headers or {"Content-Type": "application/json"}, method=method)
        try: response = urlopen(request, timeout=3)
        except HTTPError as error: response = error
        return response.status, response.headers, response.read()

    def test_binary_response_and_timing_header(self):
        status, headers, body = self.request({"text": "a teapot"}, headers={"Content-Type": "application/json", "Origin": "http://127.0.0.1:4183"})
        self.assertEqual(status, 200); self.assertEqual(body, fake_glb())
        self.assertEqual(headers["Content-Type"], "model/gltf-binary")
        self.assertEqual(headers["X-Generation-Ms"], "7")
        self.assertIn("X-Generation-Ms", headers["Access-Control-Expose-Headers"])

    def test_host_origin_content_type_and_body_rejected(self):
        for headers, expected in [({"Host": "example.com"}, 403), ({"Origin": "https://example.com"}, 403), ({"Content-Type": "text/plain"}, 415)]:
            self.assertEqual(self.request({"text": "a cube"}, headers={"Content-Type": "application/json", **headers})[0], expected)
        self.assertEqual(self.request({"text": "x" * 5000})[0], 413)
        self.assertEqual(self.request({"text": "x" * 301})[0], 400)

    def test_health_preflight_busy_and_timeout(self):
        self.assertEqual(self.request(path="/health", method="GET")[0], 200)
        self.assertEqual(self.request(method="OPTIONS", headers={"Origin": "http://127.0.0.1:4183"})[0], 204)
        self.assertEqual(self.request({"text": "busy"})[0], 503)
        self.assertEqual(self.request({"text": "timeout"})[0], 504)


if __name__ == "__main__":
    unittest.main()

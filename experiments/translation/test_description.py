"""Description route boundaries and shared inference lock, without model loading."""
import importlib.util
import json
from pathlib import Path
import sys
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from http.server import ThreadingHTTPServer

spec = importlib.util.spec_from_file_location("composition", Path(__file__).resolve().parents[2] / "server/composition.py")
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)


class DescriptionTests(unittest.TestCase):
    def test_exact_schema_and_ascii_bounds(self):
        self.assertEqual(module.parse_description('{"text_en":"a ceramic vase"}'), {"text_en": "a ceramic vase"})
        invalid = ['{"text_en":"a vase","code":"print(1)"}', '{"text_en":12}', '{"text_en":"花瓶"}', '{"text_en":"a\\nvase"}', '{"text_en":"123"}', json.dumps({"text_en": "a" * 301}), '```json\n{"text_en":"a vase"}\n```', 'return {"text_en":"a vase"}', '__import__("os")', '[]']
        for output in invalid:
            with self.subTest(output=output), self.assertRaises(module.CompositionError):
                module.parse_description(output)

    def test_no_subject_is_explicit(self):
        with self.assertRaises(module.NoVisualSubjectError):
            module.parse_description('{"text_en":""}')

    def composer(self):
        value = object.__new__(module.Composer)
        value.lock = threading.Lock()
        value.mx = SimpleNamespace(clear_cache=Mock())
        value.model = object(); value.model_id = "test-double"
        value.description_prompt = "bounded schema"
        value.description_sampler = object()
        value.tokenizer = SimpleNamespace(apply_chat_template=Mock(return_value="test prompt"))
        return value

    def test_describe_shares_the_compose_lock(self):
        value = self.composer(); value.lock.acquire()
        with self.assertRaises(BlockingIOError): value.describe("artificial text")
        value.lock.release()

    def test_success_and_one_bounded_format_retry(self):
        value = self.composer()
        generate = Mock(side_effect=['{"wrong":"value"}', '{"text_en":"a vase"}'])
        with patch.dict(sys.modules, {"mlx_lm": SimpleNamespace(generate=generate)}):
            result = value.describe("artificial text")
        self.assertEqual(result["attempts"], 2)
        self.assertEqual(result["text_en"], "a vase")
        self.assertEqual(generate.call_count, 2)
        self.assertEqual(generate.call_args.kwargs["max_tokens"], 512)
        self.assertFalse(value.lock.locked())
        value.mx.clear_cache.assert_called_once()

    def test_abstention_is_not_retried_into_hallucination(self):
        value = self.composer(); generate = Mock(return_value='{"text_en":""}')
        with patch.dict(sys.modules, {"mlx_lm": SimpleNamespace(generate=generate)}):
            with self.assertRaises(module.NoVisualSubjectError): value.describe("ambiguous text")
        generate.assert_called_once(); self.assertFalse(value.lock.locked())

    def test_failure_always_releases_lock(self):
        value = self.composer(); generate = Mock(side_effect=RuntimeError("synthetic failure"))
        with patch.dict(sys.modules, {"mlx_lm": SimpleNamespace(generate=generate)}):
            with self.assertRaises(RuntimeError): value.describe("artificial text")
        self.assertFalse(value.lock.locked()); value.mx.clear_cache.assert_called_once()


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        class FakeComposer:
            def compose(self, text): return {"route": "compose"}
            def describe(self, text):
                if text == "busy": raise BlockingIOError()
                if text == "none": raise module.NoVisualSubjectError()
                if text == "bad": raise module.CompositionError()
                return {"text_en": "a vase", "elapsedMs": 1, "model": "test-double"}
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), module.make_handler(FakeComposer(), 0))
        cls.port = cls.server.server_address[1]
        cls.server.RequestHandlerClass = module.make_handler(FakeComposer(), cls.port)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True); cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.thread.join()

    def request(self, data=None, path="/describe", headers=None):
        encoded = json.dumps(data).encode() if data is not None else None
        req = Request(f"http://127.0.0.1:{self.port}{path}", data=encoded, headers=headers or {"Content-Type": "application/json"})
        try: response = urlopen(req, timeout=3)
        except HTTPError as error: response = error
        return response.status, response.headers, json.loads(response.read())

    def test_both_routes_and_capability(self):
        status, headers, result = self.request({"text": "人工例"}, headers={"Content-Type":"application/json","Origin":"http://127.0.0.1:4183"})
        self.assertEqual(status, 200); self.assertEqual(result["text_en"], "a vase")
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(headers["Access-Control-Allow-Origin"], "http://127.0.0.1:4183")
        self.assertEqual(self.request({"text":"shape"},path="/compose")[2], {"route":"compose"})
        self.assertIn("describe", self.request(path="/health")[2]["capabilities"])

    def test_expected_failures(self):
        for text, status in [("busy",503),("none",422),("bad",422)]:
            self.assertEqual(self.request({"text":text})[0],status)

    def test_same_body_and_origin_guards(self):
        for text,status in [("",400),("a"*2001,400),("a"*17000,413)]:
            self.assertEqual(self.request({"text":text})[0],status)
        self.assertEqual(self.request({"text":"a","extra":1})[0],400)
        self.assertEqual(self.request({"text":"a"},headers={"Content-Type":"text/plain"})[0],415)
        for extra in [{"Host":"untrusted.test"},{"Origin":"https://untrusted.test"}]:
            self.assertEqual(self.request({"text":"a"},headers={"Content-Type":"application/json",**extra})[0],403)


if __name__ == "__main__": unittest.main()

"""Schema and localhost boundary tests without loading model weights."""
import copy
import importlib.util
import json
import math
from pathlib import Path
import threading
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer

spec = importlib.util.spec_from_file_location("composition", Path(__file__).resolve().parents[2] / "server/composition.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
GOOD = {"label": "test shape", "parts": [{"kind": "box", "position": [0, 0, 0], "scale": [1, 1, 1], "rotation": [0, 0, 0]}]}


class SchemaTests(unittest.TestCase):
    def test_five_supported_primitives(self):
        for kind in module.KINDS:
            value = copy.deepcopy(GOOD); value["parts"][0]["kind"] = kind
            self.assertEqual(module.validate_composition(value)["parts"][0]["kind"], kind)

    def test_code_and_unknown_fields_rejected(self):
        invalid = ["__import__('os').system('echo unsafe')", {**GOOD, "code": "run()"}, {"label": "x", "parts": []}]
        for value in invalid:
            with self.assertRaises(module.CompositionError): module.validate_composition(value)

    def test_unsupported_kind_and_numeric_bounds(self):
        for key, value in [("kind", "script"), ("scale", [0, 1, 1]), ("position", [6, 0, 0]), ("rotation", [4, 0, 0]), ("scale", [True, 1, 1]), ("scale", [math.nan, 1, 1]), ("position", [math.inf, 0, 0]), ("scale", ["1", 1, 1]), ("position", [0, 0])]:
            bad = copy.deepcopy(GOOD); bad["parts"][0][key] = value
            with self.assertRaises(module.CompositionError): module.validate_composition(bad)

    def test_part_and_label_limits(self):
        for value in [{"label": "x", "parts": GOOD["parts"] * 25}, {**GOOD, "label": "x" * 81}, {**GOOD, "label": "a\nb"}]:
            with self.assertRaises(module.CompositionError): module.validate_composition(value)
        self.assertEqual(len(module.validate_composition({**GOOD, "parts": GOOD["parts"] * 24})["parts"]), 24)

    def test_plain_json_only(self):
        self.assertEqual(module.parse_generated(json.dumps(GOOD))["label"], "test shape")
        for text in ["```json\n" + json.dumps(GOOD) + "\n```", "return " + json.dumps(GOOD), "{}"]:
            with self.assertRaises(module.CompositionError): module.parse_generated(text)

    def test_forms_are_opt_in_and_deformations_bounded(self):
        form = copy.deepcopy(GOOD); form["parts"][0]["kind"] = "vase"
        form["parts"][0]["deformation"] = {"squareness": 1, "twist": -.7}
        self.assertEqual(module.validate_composition(form, "forms")["parts"][0]["deformation"]["squareness"], 1)
        with self.assertRaises(module.CompositionError): module.validate_composition(form, "primitives")
        for bad in [{"roughness": float("nan")}, {"script": "eval()"}, {"twist": 8}]:
            form["parts"][0]["deformation"] = bad
            with self.assertRaises(module.CompositionError): module.validate_composition(form, "forms")


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        class FakeComposer:
            def compose(self, text):
                return {**GOOD, "model": "schema-test-only", "elapsedMs": 1}
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), module.make_handler(FakeComposer(), 0))
        cls.port = cls.server.server_address[1]
        cls.server.RequestHandlerClass = module.make_handler(FakeComposer(), cls.port)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True); cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.thread.join()

    def request(self, data=None, headers=None, path="/compose", method=None):
        encoded = json.dumps(data).encode() if data is not None else None
        request = Request(f"http://127.0.0.1:{self.port}{path}", data=encoded, headers=headers or {"Content-Type": "application/json"}, method=method)
        try:
            response = urlopen(request, timeout=3)
        except HTTPError as error:
            response = error
        return response.status, response.headers, response.read()

    def test_local_json_accepted(self):
        status, headers, _ = self.request({"text": "a made-up object"}, {"Content-Type": "application/json", "Origin": "http://127.0.0.1:4183"})
        self.assertEqual(status, 200)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "http://127.0.0.1:4183")

    def test_remote_origin_and_host_rejected(self):
        for headers in [{"Origin": "https://example.com"}, {"Host": "attacker.example"}]:
            self.assertEqual(self.request({"text": "test"}, {"Content-Type": "application/json", **headers})[0], 403)

    def test_body_and_content_type_limited(self):
        self.assertEqual(self.request({"text": "x" * 2001})[0], 400)
        self.assertEqual(self.request({"text": "x" * 20000})[0], 413)
        self.assertEqual(self.request({"text": "x"}, {"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.request({"text": "x", "code": "print(1)"})[0], 400)

    def test_health_and_preflight(self):
        self.assertEqual(self.request(path="/health", method="GET")[0], 200)
        self.assertEqual(self.request(path="/compose", method="OPTIONS", headers={"Origin": "http://127.0.0.1:4183"})[0], 204)


if __name__ == "__main__":
    unittest.main()

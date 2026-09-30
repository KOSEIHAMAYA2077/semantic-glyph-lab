"""CPU-only retrieval boundaries; artificial captions/vectors, no model download."""
from __future__ import annotations

import copy
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest import mock

import numpy as np

import retrieval


ROWS = [
    {"id": "fixture-vase", "name": "Vase", "description": "An artificial vase caption.",
     "path": "/retrieval-models/vase.glb", "source": "https://polyhaven.com/a/ceramic_vase_03"},
    {"id": "fixture-can", "name": "Can", "description": "An artificial watering can caption.",
     "path": "/retrieval-models/can.glb", "source": "https://polyhaven.com/a/watering_can_metal_01"},
    {"id": "fixture-sword", "name": "Sword", "description": "An artificial sword caption.",
     "path": "/retrieval-models/sword.glb", "source": "https://polyhaven.com/a/wooden_handle_saber"},
]


class FakeEmbeddings:
    def __init__(self, scores=(.2, .9, .6)):
        self.scores = scores
        self.calls = []

    def encode(self, texts):
        first = not self.calls
        self.calls.append(list(texts))
        return np.eye(3, dtype=np.float64) if first else np.array([self.scores], dtype=np.float64)


class RetrievalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.model = FakeEmbeddings()
        cls.retriever = retrieval.Retriever(cls.model, copy.deepcopy(ROWS))
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), retrieval.make_handler(cls.retriever, 0))
        cls.port = cls.server.server_address[1]
        cls.server.RequestHandlerClass = retrieval.make_handler(cls.retriever, cls.port)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=3)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="retrieval-boundary-fixtures-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.assets = self.root/"public/retrieval-models"
        self.assets.mkdir(parents=True)
        for name in ("vase.glb", "can.glb", "sword.glb"):
            # catalogue() validates metadata/filesystem, not GLB geometry.
            (self.assets/name).write_bytes(b"artificial metadata-test fixture")
        self.manifest_index = 0

    def catalogue(self, data):
        self.manifest_index += 1
        path = self.root/f"manifest-{self.manifest_index}.json"
        path.write_text(json.dumps(data, ensure_ascii=True))
        with mock.patch.object(retrieval, "ROOT", self.root):
            return retrieval.catalogue(path)

    def request(self, data=None, *, raw=None, path="/search", method="POST", headers=None):
        if raw is None:
            raw = json.dumps(data, ensure_ascii=False).encode("utf-8") if data is not None else b""
        fields = {"Host": f"127.0.0.1:{self.port}", "Content-Type": "application/json",
                  "Content-Length": str(len(raw)), **(headers or {})}
        connection = HTTPConnection("127.0.0.1", self.port, timeout=3)
        try:
            connection.putrequest(method, path, skip_host=True, skip_accept_encoding=True)
            for key, value in fields.items():
                connection.putheader(key, value)
            connection.endheaders(raw)
            response = connection.getresponse()
            body = response.read()
            return response.status, dict(response.getheaders()), json.loads(body) if body else None
        finally:
            connection.close()

    def test_catalogue_valid_list_or_wrapper_and_relative_path(self):
        rows = copy.deepcopy(ROWS)
        rows[0]["path"] = "vase.glb"
        for data in (rows, {"models": rows, "extraMetadata": "not returned"}):
            result = self.catalogue(data)
            self.assertEqual(len(result), 3)
            self.assertEqual(result[0]["path"], "/retrieval-models/vase.glb")
            self.assertEqual(set(result[0]), {"id", "name", "description", "path", "source"})

    def test_catalogue_structure_count_id_and_caption_limits(self):
        rows = copy.deepcopy(ROWS)
        rows[0].update(name="n"*200, description="d"*1200)
        self.assertEqual(len(self.catalogue(rows)[0]["description"]), 1200)
        invalid = [None, 123, "text", {}, [], [None], [42], ["row"], [True],
                   [dict(ROWS[0], id=f"asset-{i}") for i in range(33)], [ROWS[0], ROWS[0]]]
        for key, values in {"id": ["", "../escape", "Upper", "a"*81, 12],
                            "name": ["", "n"*201, None],
                            "description": ["", "d"*1201, None]}.items():
            invalid.extend([[dict(ROWS[0], **{key: value})] for value in values])
        for data in invalid:
            with self.subTest(value=repr(data)[:90]), self.assertRaises(ValueError):
                self.catalogue(data)

    def test_catalogue_path_source_and_missing_asset_rejected(self):
        paths = ["../outside.glb", "/retrieval-models/../outside.glb", "/outside.glb",
                 "/retrieval-models/subdir/model.glb", "/retrieval-models/%2e%2e.glb",
                 "https://example.invalid/model.glb", "/retrieval-models/file.gltf", "missing.glb", None]
        sources = ["http://polyhaven.com/a/vase", "https://polyhaven.com.evil.invalid/a/vase",
                   "https://polyhaven.com/a/../outside", "https://example.invalid/a/vase", None]
        for key, values in (("path", paths), ("source", sources)):
            for value in values:
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    self.catalogue([dict(ROWS[0], **{key: value})])

    def test_catalogue_symlink_cannot_escape_the_asset_directory(self):
        outside = self.root/"outside.glb"
        outside.write_bytes(b"artificial outside-asset fixture")
        (self.assets/"escape.glb").symlink_to(outside)
        with self.assertRaises(ValueError):
            self.catalogue([dict(ROWS[0], path="/retrieval-models/escape.glb")])

    def test_candidates_sorted_without_automatic_selection(self):
        model = FakeEmbeddings((.6, .9, .7))
        result = retrieval.Retriever(model, copy.deepcopy(ROWS)).search("人工の候補検索")
        self.assertEqual([row["id"] for row in result["candidates"]], ["fixture-can", "fixture-sword", "fixture-vase"])
        self.assertNotIn("selected", result)
        self.assertNotIn("threshold", result)
        self.assertEqual(result["catalogCount"], 3)
        self.assertEqual(result["maxTokens"], 128)
        self.assertEqual(model.calls[0], [r["name"]+". "+r["description"] for r in ROWS])
        for value in (-1., .4999996, .5, 1.):
            with self.subTest(score=value):
                answer = retrieval.Retriever(FakeEmbeddings((value, .2, -.1)), copy.deepcopy(ROWS)).search("人工例")
                self.assertNotIn("selected", answer)
                self.assertNotIn("threshold", answer)
                self.assertEqual(len(answer["candidates"]), 3)
                self.assertTrue(all(-1 <= row["score"] <= 1 for row in answer["candidates"]))

    def test_search_rejects_nonfinite_and_out_of_range_model_scores(self):
        for value in (float("nan"), float("inf"), -float("inf"), 1.01, -1.01):
            with self.subTest(score=value), self.assertRaises(ValueError):
                retrieval.Retriever(FakeEmbeddings((value, .2, .1)), copy.deepcopy(ROWS)).search("人工例")

    def test_http_health_preflight_and_unknown_routes(self):
        status, headers, body = self.request(path="/health", method="GET")
        self.assertEqual(status, 200)
        self.assertEqual(body["catalogCount"], 3)
        self.assertTrue(body["local"])
        self.assertFalse(body["storesInput"])
        self.assertFalse(body["sendsInput"])
        self.assertNotIn("selected", body)
        self.assertNotIn("threshold", body)
        self.assertEqual(headers["Cache-Control"], "no-store")
        status, headers, body = self.request(method="OPTIONS", headers={"Origin": "http://127.0.0.1:4183"})
        self.assertEqual(status, 204)
        self.assertIsNone(body)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "http://127.0.0.1:4183")
        for method in ("GET", "POST", "OPTIONS"):
            self.assertEqual(self.request({"text": "人工例"}, path="/missing", method=method)[0], 404)

    def test_http_host_origin_boundaries(self):
        for host in ("evil.invalid", f"127.0.0.1:{self.port+1}", f"127.0.0.1:{self.port}.evil.invalid"):
            with self.subTest(host=host):
                status, headers, _ = self.request({"text": "人工例"}, headers={"Host": host})
                self.assertEqual(status, 403)
                self.assertNotIn("Access-Control-Allow-Origin", headers)
        for origin in ("https://evil.invalid", "null", "https://127.0.0.1:4183", "http://localhost:4184"):
            with self.subTest(origin=origin):
                self.assertEqual(self.request({"text": "人工例"}, headers={"Origin": origin})[0], 403)
        for origin in ("http://127.0.0.1:4183", "http://localhost:4183"):
            status, headers, _ = self.request({"text": "人工例"}, headers={"Host": f"localhost:{self.port}", "Origin": origin})
            self.assertEqual(status, 200)
            self.assertEqual(headers["Access-Control-Allow-Origin"], origin)
        self.assertEqual(self.request({"text": "人工例"})[0], 200)

    def test_http_content_type_and_body_size(self):
        for content_type in ("text/plain", "application/jsonp", "application/octet-stream"):
            with self.subTest(content_type=content_type):
                self.assertEqual(self.request({"text": "人工例"}, headers={"Content-Type": content_type})[0], 415)
        self.assertEqual(self.request({"text": "人工例"}, headers={"Content-Type": "application/json; charset=utf-8"})[0], 200)
        body = b'{"text":"x"}'
        exact = body+b" "*(retrieval.MAX_BODY-len(body))
        self.assertEqual(self.request(raw=exact)[0], 200)
        self.assertEqual(self.request(raw=exact+b" ")[0], 413)
        for length, expected in (("0", 413), ("-1", 413), ("not-an-int", 400)):
            with self.subTest(length=length):
                self.assertEqual(self.request(raw=b"", headers={"Content-Length": length})[0], expected)

    def test_http_duplicate_keys_and_invalid_json_contract(self):
        invalid = [b'{"text":"first","text":"second"}', b'{"text":{"key":1,"key":2}}',
                   b'{"text":"x","extra":1}', b'[]', b'null', b'{"text":123}',
                   b'{"text":true}', b'{"text":NaN}', b'{"text":"x"} trailing', b'{"text":',
                   b'{"text":'+b'['*1100+b'0'+b']'*1100+b'}']
        for raw in invalid:
            with self.subTest(raw=raw):
                self.assertEqual(self.request(raw=raw)[0], 400)

    def test_http_unicode_and_character_bounds(self):
        text = "日本語e\u0301🌀"
        self.assertEqual(self.request({"text": text})[0], 200)
        self.assertEqual(self.model.calls[-1], [text])
        self.assertEqual(self.request({"text": "字"*retrieval.MAX_TEXT})[0], 200)
        for text in ("", " \n\t ", "字"*(retrieval.MAX_TEXT+1)):
            with self.subTest(length=len(text)):
                self.assertEqual(self.request({"text": text})[0], 400)
        for raw in (b'{"text":"\xff"}', b'{"text":"\\ud800"}', b'{"text":"\\udfff"}'):
            with self.subTest(raw=raw):
                self.assertEqual(self.request(raw=raw)[0], 400)

    def test_http_internal_errors_do_not_echo_private_details(self):
        with mock.patch.object(self.retriever, "search", side_effect=RuntimeError("PRIVATE_SENTINEL_DO_NOT_RETURN")):
            status, headers, body = self.request({"text": "人工の私的入力"})
        self.assertEqual(status, 500)
        self.assertEqual(body, {"error": "Local asset search failed"})
        self.assertNotIn("PRIVATE_SENTINEL", json.dumps(body))
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")


if __name__ == "__main__":
    unittest.main()

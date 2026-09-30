import http.client
from http.server import ThreadingHTTPServer
import json
import threading
import unittest

from app import handler_for
from interpreter import Interpreter


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(Interpreter(), 0))
        cls.port = cls.server.server_address[1]
        cls.server.RequestHandlerClass = handler_for(Interpreter(), 0, cls.port)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=4)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def test_health_and_no_store(self):
        status, headers, body = self.request("GET", "/health")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertFalse(json.loads(body)["storesInput"])

    def test_only_known_origins(self):
        for origin, expected in [("http://127.0.0.1:4183", 200), ("http://localhost:4183", 200), ("https://evil.example", 403), ("null", 403)]:
            status, headers, _body = self.request("GET", "/health", headers={"Origin": origin})
            self.assertEqual(status, expected)
            if expected == 200:
                self.assertEqual(headers["Access-Control-Allow-Origin"], origin)
            else:
                self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_preflight(self):
        status, headers, _body = self.request("OPTIONS", "/interpret", headers={"Origin": "http://localhost:4183"})
        self.assertEqual(status, 204)
        self.assertIn("POST", headers["Access-Control-Allow-Methods"])

    def test_rebinding_host_rejected(self):
        status, _headers, _body = self.request("GET", "/health", headers={"Host": "evil.example"})
        self.assertEqual(status, 403)

    def test_json_interpret_and_validation(self):
        payload = json.dumps({"text": "四角い花瓶", "mode": "rules"}).encode()
        status, _headers, body = self.request("POST", "/interpret", payload, {"Content-Type": "application/json"})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["spec"]["object"], "vase")
        for payload, expected in [(b"[]", 400), (b'{"text":null}', 400), (b'{"text":NaN}', 400), (b"{" * 33000, 413)]:
            status, _headers, _body = self.request("POST", "/interpret", payload, {"Content-Type": "application/json"})
            self.assertEqual(status, expected)


if __name__ == "__main__":
    unittest.main()

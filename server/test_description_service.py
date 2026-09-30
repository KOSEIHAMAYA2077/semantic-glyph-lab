"""Description-only HTTP routes and pinned model boundary; no model loading."""
import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer

import description
from composition import NoVisualSubjectError


class DescriptionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        class Fake:
            lock=threading.Lock()
            def describe(self,text):
                if text=="busy":raise BlockingIOError()
                if text=="none":raise NoVisualSubjectError()
                return {"text_en":"a teapot","model":description.MODEL_ID,"elapsedMs":1,"attempts":1}
            def compose(self,text):raise AssertionError("Composition must never be exposed")
        cls.server=ThreadingHTTPServer(("127.0.0.1",0),description.make_handler(Fake(),0))
        cls.port=cls.server.server_address[1];cls.server.RequestHandlerClass=description.make_handler(Fake(),cls.port)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()

    @classmethod
    def tearDownClass(cls):cls.server.shutdown();cls.server.server_close();cls.thread.join()

    def request(self,data=None,path="/describe",headers=None,method=None):
        encoded=json.dumps(data).encode() if data is not None else None
        req=Request(f"http://127.0.0.1:{self.port}{path}",data=encoded,headers=headers or {"Content-Type":"application/json"},method=method)
        try:response=urlopen(req,timeout=3)
        except HTTPError as error:response=error
        body=response.read()
        return response.status,response.headers,json.loads(body) if body else None

    def test_describe_and_correct_health_identity(self):
        status,headers,result=self.request({"text":"人工例"},headers={"Content-Type":"application/json","Origin":"http://127.0.0.1:4183"})
        self.assertEqual(status,200);self.assertEqual(result["model"],description.MODEL_ID)
        self.assertEqual(headers["Access-Control-Allow-Origin"],"http://127.0.0.1:4183")
        self.assertEqual(headers["Cache-Control"],"no-store")
        status,_,health=self.request(path="/health")
        self.assertEqual(status,200);self.assertEqual(health["capabilities"],["describe"])
        self.assertEqual(health["revision"],description.REVISION);self.assertFalse(health["busy"])

    def test_compose_is_not_provided(self):
        for method in ["POST","OPTIONS"]:
            self.assertEqual(self.request({"text":"shape"},path="/compose",method=method)[0],404)

    def test_guard_and_input_limits(self):
        for extra in [{"Host":"invalid.example"},{"Origin":"https://invalid.example"}]:
            self.assertEqual(self.request({"text":"x"},headers={"Content-Type":"application/json",**extra})[0],403)
        self.assertEqual(self.request({"text":"a"*2001})[0],400)
        self.assertEqual(self.request({"text":"a"*18000})[0],413)
        self.assertEqual(self.request({"text":"a","extra":1})[0],400)
        self.assertEqual(self.request({"text":"a"},headers={"Content-Type":"text/plain"})[0],415)

    def test_busy_abstention_and_preflight(self):
        self.assertEqual(self.request({"text":"busy"})[0],503)
        self.assertEqual(self.request({"text":"none"})[0],422)
        self.assertEqual(self.request(method="OPTIONS",headers={"Origin":"http://127.0.0.1:4183"})[0],204)

    def test_wrong_model_identity_rejected_before_loading(self):
        with tempfile.TemporaryDirectory() as folder:
            manifest=Path(folder)/"manifest.json";manifest.write_text(json.dumps({"model":"untrusted/model"}))
            with self.assertRaises(RuntimeError):description.verify_model_files(manifest_path=manifest)

    def test_unexpected_paths_rejected_before_reading(self):
        with tempfile.TemporaryDirectory() as folder:
            manifest=Path(folder)/"manifest.json"
            manifest.write_text(json.dumps({"model":description.MODEL_ID,"revision":description.REVISION,"license":"apache-2.0","files":[{"name":"../../outside"}]}))
            with self.assertRaises(RuntimeError):description.verify_model_files(manifest_path=manifest)


if __name__=="__main__":unittest.main()

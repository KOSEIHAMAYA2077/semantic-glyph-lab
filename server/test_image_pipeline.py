"""CPU boundary, transport and owned-process tests; no model inference."""
import json
import struct
import subprocess
import sys
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import image_pipeline as api


def fake_tokenizer(text, **kwargs):
    assert kwargs.get('truncation') is False
    return {'input_ids': [0] * (len(text.split()) + 2)}


def glb():
    body = b'{"asset":{"version":"2.0"}}'
    body += b' ' * (-len(body) % 4)
    return struct.pack('<4sII', b'glTF', 2, 20+len(body)) + struct.pack('<I4s', len(body), b'JSON') + body


def fake_commands(delay=0):
    def command(kind):
        data = api.pack({'imageMs': 1}, b'\x89PNG\r\n\x1a\nfixture') if kind == 'image' else api.pack({'faces': 0}, glb())
        return [sys.executable, '-B', '-c', 'import sys,time;sys.stdin.buffer.read();'
            f'time.sleep({delay!r});sys.stdout.buffer.write({data!r})']
    return command


class BoundaryTests(unittest.TestCase):
    def test_payload_shape_ascii_and_reserved_context(self):
        validator = api.TextValidator([fake_tokenizer, fake_tokenizer])
        self.assertEqual(validator({'text': ' a vase '})['text'], 'a vase')
        for payload in [{'text': ''}, {'text': '1234'}, {'text': '花瓶'}, {'text': 'vase\x00'},
                        {'text': 'a'*301}, {'text': 'a vase', 'seed': 2}, {'text': 'a '*60}]:
            with self.assertRaises(api.RequestError): validator(payload)

    def test_both_real_tokenizers_and_no_truncation(self):
        validator = api.TextValidator()
        self.assertLessEqual(validator({'text': 'a simple ceramic vase'})['clipTokens'], 77)
        with self.assertRaises(api.RequestError) as error:
            validator({'text': 'b! '*80})
        self.assertNotIn('b! b!', str(error.exception))
        self.assertGreater(validator({'text': 'a vase'})['clipTokens'], 5)

    def test_small_empty_and_full_masks_rejected(self):
        import numpy as np
        for alpha in [np.zeros((512,512),np.uint8), np.full((512,512),255,np.uint8)]:
            with self.assertRaises(api.QualityError): api.mask_measure(alpha)
        alpha = np.zeros((512,512),np.uint8);alpha[100:200,100:200] = 255
        with self.assertRaises(api.QualityError): api.mask_measure(alpha)
        alpha[100:350,100:350] = 255
        self.assertAlmostEqual(api.mask_measure(alpha), 250*250/(512*512))

    def test_frame_and_glb_validation(self):
        meta, data = api.unpack(api.pack({'faces': 3}, glb()))
        self.assertEqual(meta['faces'],3);api.validate_glb(data)
        for value in [b'', b'1234', struct.pack('<I',5000)+b'x'*5000]:
            with self.assertRaises((api.GenerationError, ValueError)): api.unpack(value)
        for value in [b'not a mesh'*3, glb()+b'x']:
            with self.assertRaises(api.GenerationError): api.validate_glb(value)
        with self.assertRaises(api.QualityError): api.unpack(api.pack({'error':'mask'}))

    def test_pipeline_memory_round_trip(self):
        generator = api.Generator(timeout=3, command_factory=fake_commands())
        try:
            result=generator.generate('a vase')
            self.assertEqual(result['data'],glb())
            self.assertIsNone(generator.process)
            self.assertFalse(generator.lock.locked())
        finally: generator.close()

    def test_timeout_only_stops_owned_worker(self):
        unrelated = subprocess.Popen([sys.executable,'-c','import time;time.sleep(10)'], stdout=subprocess.DEVNULL)
        generator=api.Generator(timeout=.1,command_factory=fake_commands(2))
        try:
            with self.assertRaises(TimeoutError): generator.generate('a vase')
            self.assertIsNone(generator.process)
            self.assertFalse(generator.lock.locked())
            self.assertIsNone(unrelated.poll())
        finally:
            generator.close();unrelated.terminate();unrelated.wait(timeout=2)

    def test_total_timeout_covers_both_workers(self):
        generator=api.Generator(timeout=.35,command_factory=fake_commands(.22))
        try:
            with self.assertRaises(TimeoutError): generator.generate('a vase')
            self.assertIsNone(generator.process)
        finally: generator.close()

    def test_busy_is_rejected_and_closed_generator_stays_closed(self):
        generator=api.Generator(timeout=3,command_factory=fake_commands())
        generator.lock.acquire()
        try:
            with self.assertRaises(BlockingIOError):generator.generate('a vase')
        finally: generator.lock.release()
        generator.close()
        with self.assertRaises(api.GenerationError):generator.generate('a vase')


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        class FakeGenerator:
            lock=threading.Lock()
            timeout=120
            def ready(self):return True
            def generate(self,text):
                if text=='busy':raise BlockingIOError()
                if text=='timeout':raise TimeoutError()
                if text=='empty mask':raise api.QualityError(api.ERRORS['mask'])
                return {'data':glb(),'elapsedMs':9,'imageMs':2,'reconstructionMs':3,'imageStageMs':5,'faces':0}
        cls.generator=FakeGenerator();cls.validator=api.TextValidator([fake_tokenizer])
        cls.server=api.QuietServer(('127.0.0.1',0),api.make_handler(cls.generator,0,cls.validator))
        cls.port=cls.server.server_address[1]
        cls.server.RequestHandlerClass=api.make_handler(cls.generator,cls.port,cls.validator)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join()

    def request(self,value=None,path='/generate',headers=None,method=None):
        data=json.dumps(value).encode() if value is not None else None
        req=Request(f'http://127.0.0.1:{self.port}{path}',data=data,
            headers={'Content-Type':'application/json',**(headers or {})},method=method)
        try:response=urlopen(req,timeout=3)
        except HTTPError as error:response=error
        return response.status,response.headers,response.read()

    def test_binary_timing_and_no_cache(self):
        status,headers,body=self.request({'text':'a vase'},headers={'Origin':'http://127.0.0.1:4183'})
        self.assertEqual(status,200);self.assertEqual(body,glb())
        self.assertEqual(headers['Content-Type'],'model/gltf-binary')
        self.assertEqual(headers['Cache-Control'],'no-store')
        self.assertEqual(headers['X-Generation-Ms'],'9')
        self.assertIn('X-Image-Stage-Ms',headers['Access-Control-Expose-Headers'])

    def test_host_origin_type_length_and_text_limits(self):
        for headers,status in [({'Host':'evil.test'},403),({'Origin':'https://evil.test'},403),
                               ({'Content-Type':'text/plain'},415),({'Transfer-Encoding':'chunked'},400)]:
            self.assertEqual(self.request({'text':'a vase'},headers=headers)[0],status)
        self.assertEqual(self.request({'text':'a'*5000})[0],413)
        self.assertEqual(self.request({'text':'a'*301})[0],400)
        self.assertEqual(self.request({'text':'a '*60})[0],400)

    def test_health_preflight_and_actionable_failures(self):
        status,headers,body=self.request(path='/health',method='GET')
        self.assertEqual(status,200)
        health=json.loads(body);self.assertFalse(health['storesInput']);self.assertFalse(health['storesOutput'])
        self.assertEqual(self.request(method='OPTIONS',headers={'Origin':'http://localhost:4183'})[0],204)
        for text,status in [('busy',503),('timeout',504),('empty mask',422)]:
            self.assertEqual(self.request({'text':text})[0],status)


if __name__=='__main__':unittest.main()

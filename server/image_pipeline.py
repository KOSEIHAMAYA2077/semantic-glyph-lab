"""Loopback-only text -> image -> mesh service; request artifacts never touch disk."""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import signal
import socket
import struct
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / '.local/image-pipeline-runtime'
SCRIPT = Path(__file__).resolve()
IMAGE_PYTHON = ROOT / '.local/text-image-venv/bin/python'
MESH_PYTHON = ROOT / '.local/triposr-venv/bin/python'
SDXL = ROOT / '.local/text-image-sdxl-turbo'
TRIPOSR = ROOT / '.local/triposr-model'
BACKGROUND = ROOT / '.local/text-image-background'
MAX_BODY, MAX_TEXT, MAX_PNG, MAX_GLB = 4096, 300, 4 * 1024**2, 24 * 1024**2
ORIGINS = {'http://127.0.0.1:4183', 'http://localhost:4183'}
SUFFIX = '. One complete isolated object centered on a plain gray background. Matte clay sculpture, three-quarter product view.'
SEED, STEPS, GRID = 20260930, 4, 128
sys.dont_write_bytecode = True


class RequestError(ValueError):
    pass


class GenerationError(RuntimeError):
    pass


class QualityError(GenerationError):
    pass


ERRORS = {
    'request': 'Input exceeds the local CLIP context; shorten the description',
    'mask': 'Foreground mask is empty, too small, or does not separate an object',
    'mesh': 'Reconstruction did not produce a usable mesh',
    'generation': 'Local image or mesh generation failed',
}


def configure_environment():
    for key, suffix in [('HF_HOME', 'hf'), ('MPLCONFIGDIR', 'mpl'), ('NUMBA_CACHE_DIR', 'numba')]:
        os.environ[key] = str(RUNTIME / suffix)
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1',
                      PYTHONDONTWRITEBYTECODE='1', OMP_NUM_THREADS='4', TOKENIZERS_PARALLELISM='false')
    os.environ['U2NET_HOME'] = str(BACKGROUND)  # Existing verified ONNX is read only.


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(8 * 1024**2), b''):
            result.update(block)
    return result.hexdigest()


def verify_manifest(directory, path, key, prefix=None):
    record = json.loads(path.read_text())
    for item in record[key]:
        if prefix is not None and not item['file'].startswith(prefix):
            continue
        file = (directory / item['file']).resolve()
        if not file.is_relative_to(directory.resolve()) or digest(file) != item['sha256']:
            raise GenerationError('Model file verification failed')


def basic_text(data):
    if type(data) is not dict or set(data) != {'text'} or type(data['text']) is not str:
        raise RequestError('Expected one text string')
    raw = data['text']
    text = raw.strip()
    if not 1 <= len(raw) <= MAX_TEXT or not text:
        raise RequestError('Use 1 to 300 ASCII characters')
    if any(ord(c) > 126 or (ord(c) < 32 and c not in '\n\t') for c in raw):
        raise RequestError('Use a short English/ASCII description')
    if not any('a' <= c.lower() <= 'z' for c in text):
        raise RequestError('Describe an object using English words')
    return text


class TextValidator:
    def __init__(self, tokenizers=None):
        if tokenizers is None:
            configure_environment()
            verify_manifest(SDXL, ROOT / 'experiments/text-image/model-manifest.json', 'files', 'tokenizer')
            from transformers import CLIPTokenizer
            tokenizers = [CLIPTokenizer.from_pretrained(SDXL / name, local_files_only=True)
                          for name in ['tokenizer', 'tokenizer_2']]
        self.tokenizers = tokenizers

    def __call__(self, data):
        text = basic_text(data)
        prompt = text + SUFFIX
        counts = []
        for tokenizer in self.tokenizers:
            # truncation=False is explicit; errors never expose the source text.
            try:
                count = len(tokenizer(prompt, truncation=False, verbose=False)['input_ids'])
            except Exception:
                raise RequestError('Could not validate the local text context') from None
            if count > 77:
                raise RequestError('Description plus fixed image framing exceeds 77 CLIP tokens; shorten it')
            counts.append(count)
        return {'text': text, 'clipTokens': max(counts)}


def validate_glb(data):
    if type(data) is not bytes or not 20 <= len(data) <= MAX_GLB:
        raise GenerationError('Generated mesh size is outside limits')
    if struct.unpack_from('<4sII', data) != (b'glTF', 2, len(data)):
        raise GenerationError('Invalid GLB header')


def pack(metadata, payload=b''):
    header = json.dumps(metadata, allow_nan=False).encode()
    if len(header) > 4096 or len(payload) > MAX_GLB:
        raise GenerationError('Worker response exceeds limits')
    return struct.pack('<I', len(header)) + header + payload


def unpack(data):
    if not 4 <= len(data) <= MAX_GLB + 4100:
        raise GenerationError('Worker response exceeds limits')
    length = struct.unpack_from('<I', data)[0]
    if length > 4096 or 4 + length > len(data):
        raise GenerationError('Invalid worker response')
    metadata = json.loads(data[4:4+length])
    if type(metadata) is not dict:
        raise GenerationError('Invalid worker metadata')
    if metadata.get('error'):
        code = metadata['error']
        if code in {'mask', 'mesh'}:
            raise QualityError(ERRORS[code])
        if code == 'request':
            raise RequestError(ERRORS[code])
        raise GenerationError(ERRORS['generation'])
    return metadata, data[4+length:]


def no_network(*args, **kwargs):
    raise GenerationError('Network is disabled in this worker')


def image_worker(payload):
    import numpy as np
    import torch
    from diffusers import StableDiffusionXLPipeline
    request = json.loads(payload)
    checked = TextValidator()(request)
    verify_manifest(SDXL, ROOT / 'experiments/text-image/model-manifest.json', 'files')
    index = json.loads((SDXL / 'model_index.json').read_text())
    expected = {'scheduler': ['diffusers', 'EulerAncestralDiscreteScheduler'],
        'text_encoder': ['transformers', 'CLIPTextModel'], 'text_encoder_2': ['transformers', 'CLIPTextModelWithProjection'],
        'tokenizer': ['transformers', 'CLIPTokenizer'], 'tokenizer_2': ['transformers', 'CLIPTokenizer'],
        'unet': ['diffusers', 'UNet2DConditionModel'], 'vae': ['diffusers', 'AutoencoderKL']}
    if index['_class_name'] != 'StableDiffusionXLPipeline' or any(index[k] != v for k, v in expected.items()):
        raise GenerationError('Unapproved model components')
    if not torch.backends.mps.is_available():
        raise GenerationError('MPS is unavailable')
    torch.set_num_threads(4)
    pipe = StableDiffusionXLPipeline.from_pretrained(SDXL, torch_dtype=torch.float16, variant='fp16',
        use_safetensors=True, local_files_only=True).to('mps')
    pipe.set_progress_bar_config(disable=True)
    torch.mps.synchronize(); started = time.perf_counter()
    with torch.inference_mode():
        image = pipe(prompt=checked['text'] + SUFFIX, num_inference_steps=STEPS, guidance_scale=0,
            height=512, width=512, generator=torch.Generator('cpu').manual_seed(SEED)).images[0]
    torch.mps.synchronize()
    if np.asarray(image).std() < 2:
        raise GenerationError('Image generation produced no usable variation')
    output = io.BytesIO(); image.save(output, format='PNG')
    png = output.getvalue()
    if len(png) > MAX_PNG:
        raise GenerationError('Generated image exceeds limits')
    return {'imageMs': round((time.perf_counter()-started)*1000), 'clipTokens': checked['clipTokens'],
            'watermark': pipe.watermark is not None}, png


def mask_measure(alpha):
    import numpy as np
    foreground = alpha > 127
    fraction = float(foreground.mean())
    if not .04 <= fraction <= .92:
        raise QualityError(ERRORS['mask'])
    ys, xs = np.nonzero(foreground)
    if len(xs) == 0 or min(xs.max()-xs.min(), ys.max()-ys.min()) < 12:
        raise QualityError(ERRORS['mask'])
    return fraction


def mesh_worker(payload):
    import numpy as np
    import torch
    import trimesh
    from PIL import Image
    from omegaconf import OmegaConf
    import rembg
    if not 8 <= len(payload) <= MAX_PNG or not payload.startswith(b'\x89PNG\r\n\x1a\n'):
        raise GenerationError('Invalid generated image')
    image = Image.open(io.BytesIO(payload))
    if image.size != (512, 512):
        raise GenerationError('Unexpected generated image dimensions')
    image = image.convert('RGB')
    bg = json.loads((ROOT / 'experiments/text-image/background-manifest.json').read_text())
    if digest(BACKGROUND / 'u2netp.onnx') != bg['sha256']:
        raise GenerationError('Background model verification failed')
    session = rembg.new_session('u2netp', providers=['CPUExecutionProvider'])
    rgba = rembg.remove(image, session=session)
    fraction = mask_measure(np.asarray(rgba)[:, :, 3])
    verify_manifest(TRIPOSR, ROOT / 'experiments/triposr/model-manifest.json', 'artifacts')
    sys.path.insert(0, str(ROOT / 'experiments/triposr'))
    from mac_runner import load_upstream
    configure_environment()  # The read-only adapter defines old cache paths at import.
    TSR = load_upstream()
    from tsr.utils import resize_foreground
    a = np.asarray(resize_foreground(rgba, .85), dtype=np.float32)/255
    image = Image.fromarray((255*(a[:, :, :3]*a[:, :, 3:4]+.5*(1-a[:, :, 3:4]))).astype(np.uint8))
    cfg = OmegaConf.load(TRIPOSR / 'config.yaml')
    expected = {'image_tokenizer_cls': 'tsr.models.tokenizers.image.DINOSingleImageTokenizer',
        'tokenizer_cls': 'tsr.models.tokenizers.triplane.Triplane1DTokenizer',
        'backbone_cls': 'tsr.models.transformer.transformer_1d.Transformer1D',
        'post_processor_cls': 'tsr.models.network_utils.TriplaneUpsampleNetwork',
        'decoder_cls': 'tsr.models.network_utils.NeRFMLP', 'renderer_cls': 'tsr.models.nerf_renderer.TriplaneNeRFRenderer'}
    if any(cfg[k] != v for k, v in expected.items()):
        raise GenerationError('Unapproved reconstruction classes')
    OmegaConf.resolve(cfg)
    torch.set_num_threads(4)
    model = TSR(cfg)
    state = torch.load(TRIPOSR / 'model.ckpt', map_location='cpu', weights_only=True)
    model.load_state_dict(state, strict=True); del state
    model.eval().to('mps'); model.renderer.set_chunk_size(8192)
    torch.mps.synchronize(); started = time.perf_counter()
    with torch.inference_mode():
        codes = model([image], device='mps')
        if not torch.isfinite(codes).all():
            raise QualityError(ERRORS['mesh'])
        mesh = model.extract_mesh(codes, False, resolution=GRID)[0]
    torch.mps.synchronize()
    if not 200 <= len(mesh.faces) <= 400000 or len(mesh.vertices) > 250000:
        raise QualityError(ERRORS['mesh'])
    if (not np.isfinite(mesh.vertices).all() or np.max(np.abs(mesh.vertices)) > 5
            or min(mesh.extents) < .002 or mesh.area < .001 or mesh.volume <= 1e-6):
        raise QualityError(ERRORS['mesh'])
    if not mesh.is_watertight or not mesh.is_winding_consistent:
        raise QualityError(ERRORS['mesh'])
    mesh.apply_transform(trimesh.transformations.rotation_matrix(-np.pi/2, [1, 0, 0]))
    data = mesh.export(file_type='glb'); validate_glb(data)
    reloaded = trimesh.load(io.BytesIO(data), file_type='glb', force='mesh', process=False)
    if len(reloaded.faces) != len(mesh.faces) or not np.isfinite(reloaded.vertices).all():
        raise QualityError(ERRORS['mesh'])
    return {'reconstructionMs': round((time.perf_counter()-started)*1000), 'foregroundFraction': fraction,
            'vertices': len(mesh.vertices), 'faces': len(mesh.faces), 'grid': GRID}, data


def worker_main(kind):
    configure_environment()
    socket.socket.connect = no_network; socket.create_connection = no_network
    output = sys.stdout.buffer
    try:
        limit = MAX_BODY if kind == 'image' else MAX_PNG
        payload = sys.stdin.buffer.read(limit+1)
        if len(payload) > limit:
            raise GenerationError('Worker input exceeds limits')
        with open(os.devnull, 'w') as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            metadata, result = image_worker(payload) if kind == 'image' else mesh_worker(payload)
        output.write(pack(metadata, result)); output.flush()
    except RequestError:
        output.write(pack({'error': 'request'})); output.flush()
    except QualityError as error:
        output.write(pack({'error': 'mask' if str(error) == ERRORS['mask'] else 'mesh'})); output.flush()
    except Exception:
        output.write(pack({'error': 'generation'})); output.flush()


class Generator:
    def __init__(self, timeout=120, command_factory=None):
        self.timeout = timeout
        self.lock, self.state_lock = threading.Lock(), threading.Lock()
        self.process = None
        self.closed = False
        self.command_factory = command_factory or (lambda kind: [str(IMAGE_PYTHON if kind == 'image' else MESH_PYTHON), '-B', str(SCRIPT), '--worker', kind])

    def ready(self):
        return not self.closed and IMAGE_PYTHON.exists() and MESH_PYTHON.exists()

    @staticmethod
    def stop(process):
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait(timeout=2)

    def run_worker(self, kind, payload, deadline):
        remaining = deadline-time.perf_counter()
        if remaining <= 0:
            raise TimeoutError('Generation timed out')
        configure_environment()
        with self.state_lock:
            if self.closed:
                raise GenerationError('Service is stopping')
            process = subprocess.Popen(self.command_factory(kind), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL, env=os.environ.copy(), cwd=ROOT)
            self.process = process
        try:
            data, _ = process.communicate(input=payload, timeout=remaining)
            if process.returncode != 0:
                raise GenerationError(ERRORS['generation'])
            return unpack(data)
        except subprocess.TimeoutExpired:
            self.stop(process)
            raise TimeoutError('Generation timed out; its worker was stopped') from None
        finally:
            self.stop(process)
            if process.stdin is not None: process.stdin.close()
            if process.stdout is not None: process.stdout.close()
            with self.state_lock:
                if self.process is process: self.process = None

    def generate(self, text):
        if not self.lock.acquire(blocking=False):
            raise BlockingIOError('A generation is already running')
        began = time.perf_counter(); deadline = began+self.timeout
        try:
            image_meta, png = self.run_worker('image', json.dumps({'text': text}).encode(), deadline)
            if not 8 <= len(png) <= MAX_PNG or not png.startswith(b'\x89PNG\r\n\x1a\n'):
                raise GenerationError('Invalid image worker response')
            image_stage = round((time.perf_counter()-began)*1000)
            mesh_meta, data = self.run_worker('mesh', png, deadline)
            validate_glb(data)
            return {**image_meta, **mesh_meta, 'data': data, 'elapsedMs': round((time.perf_counter()-began)*1000),
                'imageStageMs': image_stage, 'seed': SEED, 'steps': STEPS}
        finally:
            self.lock.release()

    def close(self):
        with self.state_lock:
            self.closed = True
            self.stop(self.process)


def make_handler(generator, port, validator):
    class Handler(BaseHTTPRequestHandler):
        server_version = 'LocalImageMesh/0.1'

        def log_message(self, *_args): pass

        def setup(self):
            super().setup(); self.connection.settimeout(10)

        def allowed(self):
            return (len(self.headers.get_all('Host', [])) == 1 and len(self.headers.get_all('Origin', [])) <= 1
                and self.headers.get('Host') in {f'127.0.0.1:{port}', f'localhost:{port}'}
                and self.headers.get('Origin') in ORIGINS | {None})

        def headers_for(self, status, kind, length):
            self.send_response(status)
            self.send_header('Content-Type', kind); self.send_header('Content-Length', str(length))
            self.send_header('Cache-Control', 'no-store'); self.send_header('X-Content-Type-Options', 'nosniff')
            if self.headers.get('Origin') in ORIGINS:
                self.send_header('Access-Control-Allow-Origin', self.headers['Origin'])
                self.send_header('Vary', 'Origin')
                self.send_header('Access-Control-Expose-Headers', 'X-Generation-Ms, X-Image-Ms, X-Reconstruction-Ms, X-Image-Stage-Ms, X-Generation-Seed, X-CLIP-Tokens, X-Mesh-Faces')

        def json_reply(self, status, value):
            data = json.dumps(value, allow_nan=False).encode()
            self.headers_for(status, 'application/json; charset=utf-8', len(data)); self.end_headers()
            try: self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError): pass

        def do_OPTIONS(self):
            if not self.allowed(): return self.json_reply(403, {'error': 'Origin or Host is not allowed'})
            self.headers_for(204, 'text/plain', 0)
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type'); self.end_headers()

        def do_GET(self):
            if not self.allowed(): return self.json_reply(403, {'error': 'Origin or Host is not allowed'})
            if self.path != '/health': return self.json_reply(404, {'error': 'Not found'})
            return self.json_reply(200, {'ready': generator.ready(), 'busy': generator.lock.locked(),
                'pipeline': 'SDXL Turbo -> U2NETP -> TripoSR', 'coldStartPerRequest': True, 'device': 'mps',
                'maxTextChars': MAX_TEXT, 'clipContext': 77, 'timeoutSeconds': generator.timeout,
                'storesInput': False, 'storesOutput': False, 'attribution': 'Powered by Stability AI'})

        def do_POST(self):
            if not self.allowed(): return self.json_reply(403, {'error': 'Origin or Host is not allowed'})
            if self.path != '/generate': return self.json_reply(404, {'error': 'Not found'})
            if self.headers.get_content_type() != 'application/json':
                return self.json_reply(415, {'error': 'Use application/json'})
            if self.headers.get('Transfer-Encoding') or len(self.headers.get_all('Content-Length', [])) != 1:
                return self.json_reply(400, {'error': 'Use one Content-Length header'})
            try:
                length = int(self.headers['Content-Length'])
                if not 1 <= length <= MAX_BODY:
                    return self.json_reply(413, {'error': 'Request body exceeds limits'})
                body = self.rfile.read(length)
                if len(body) != length: raise RequestError('Incomplete request body')
                data = json.loads(body)
                checked = validator(data)
                result = generator.generate(checked['text'])
                self.headers_for(200, 'model/gltf-binary', len(result['data']))
                for header, key in [('X-Generation-Ms', 'elapsedMs'), ('X-Image-Ms', 'imageMs'),
                    ('X-Reconstruction-Ms', 'reconstructionMs'), ('X-Image-Stage-Ms', 'imageStageMs'),
                    ('X-Generation-Seed', 'seed'), ('X-Mesh-Faces', 'faces')]:
                    if key in result: self.send_header(header, str(result[key]))
                self.send_header('X-CLIP-Tokens', str(checked['clipTokens'])); self.end_headers()
                self.wfile.write(result['data'])
            except (RequestError, json.JSONDecodeError, UnicodeDecodeError, ValueError) as error:
                message = str(error) if type(error) is RequestError else 'Invalid JSON request'
                self.json_reply(400, {'error': message})
            except BlockingIOError: self.json_reply(503, {'error': 'One generation is already running; try again later'})
            except TimeoutError: self.json_reply(504, {'error': 'Generation timed out; its worker was stopped'})
            except QualityError as error: self.json_reply(422, {'error': str(error)})
            except (BrokenPipeError, ConnectionResetError): pass
            except Exception: self.json_reply(500, {'error': ERRORS['generation']})
    return Handler


class QuietServer(ThreadingHTTPServer):
    daemon_threads = True
    def handle_error(self, *_args): pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=4187)
    parser.add_argument('--timeout', type=float, default=120)
    parser.add_argument('--worker', choices=['image', 'mesh'])
    args = parser.parse_args()
    if args.worker:
        return worker_main(args.worker)
    configure_environment()
    validator = TextValidator()
    generator = Generator(timeout=args.timeout)
    server = QuietServer(('127.0.0.1', args.port), make_handler(generator, args.port, validator))
    def stopped(*_args): raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, stopped)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: generator.close(); server.server_close()


if __name__ == '__main__': main()

#!/usr/bin/env python3
"""Start only this new lab's already-installed services; never install or kill by port."""
from pathlib import Path
from urllib.request import urlopen
from urllib.error import URLError
import argparse
import json
import shutil
import socket
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
SERVICES = [
    ('meaning', 4184, 'semantics-venv', 'server/app.py'),
    ('composition', 4185, 'composition-venv', 'server/composition.py'),
    ('generation', 4186, 'shap-e-venv', 'server/generation.py'),
]

def probe(port, path='/health'):
    try:
        with urlopen(f'http://127.0.0.1:{port}{path}', timeout=2) as response:
            return response.read(16384)
    except (URLError, TimeoutError, OSError):
        return None

def occupied(port):
    with socket.socket() as sock:
        return sock.connect_ex(('127.0.0.1', port)) == 0

def verified_service(name, data):
    try:
        obj=json.loads(data)
        if name=='meaning': return 'semanticReady' in obj and obj.get('model')=='sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2' and obj.get('storesInput') is False
        if name=='composition': return obj.get('model') in ('Qwen/Qwen3-4B-Instruct-2507','Qwen/Qwen3-4B-MLX-4bit')
        return obj.get('model')=='openai/shap-e:text300M' and obj.get('local') is True
    except (ValueError, TypeError):
        return False

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check',action='store_true',help='Read service status without starting or stopping anything')
    args=parser.parse_args()
    if args.check:
        for name,port,_,_ in SERVICES:
            print(f'{name} {port}: '+('ready' if verified_service(name,probe(port)) else 'not ready'))
        print('view 4183: '+('ready' if b'Semantic Glyph Lab' in (probe(4183,'/') or b'') else 'not ready'))
        return
    children=[]; logs=[]
    run=ROOT/'.local'/'runtime'/time.strftime('%Y%m%d-%H%M%S')
    run.mkdir(parents=True,exist_ok=False)
    try:
        for name,port,env,script in SERVICES:
            if occupied(port):
                if not verified_service(name,probe(port)): raise RuntimeError(f'Port {port} is occupied by an unverified service; nothing stopped.')
                print(f'{name}: existing service reused',flush=True);continue
            python=ROOT/'.local'/env/('Scripts/python.exe' if __import__('os').name=='nt' else 'bin/python')
            if not python.exists():
                print(f'{name}: environment not installed; optional service skipped',flush=True);continue
            log=(run/f'{name}.log').open('xb');logs.append(log)
            child=subprocess.Popen([str(python),script],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT);children.append(child)
            end=time.monotonic()+120
            while time.monotonic()<end:
                if child.poll() is not None: raise RuntimeError(f'{name} exited; see {run/name}.log')
                if verified_service(name,probe(port)):break
                time.sleep(.3)
            else: raise RuntimeError(f'{name} did not become ready within 120 seconds')
            print(f'{name}: ready',flush=True)
        if occupied(4183):
            if b'Semantic Glyph Lab' not in (probe(4183,'/') or b''):raise RuntimeError('Port 4183 is occupied by another app; nothing stopped.')
        else:
            node=shutil.which('node')
            if not node or not (ROOT/'node_modules'/'vite').exists():raise RuntimeError('Install the frontend dependencies listed in README first.')
            child=subprocess.Popen([node,'node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4183','--strictPort'],cwd=ROOT);children.append(child)
        print('Open http://127.0.0.1:4183/ — Ctrl+C stops only processes started by this command.',flush=True)
        if not children:return
        while True:
            if any(child.poll() is not None for child in children):raise RuntimeError('A started service exited; its log remains in .local/runtime.')
            time.sleep(1)
    except KeyboardInterrupt:
        print('\nStopping owned services. Existing services remain running.')
    finally:
        # Popen handles identify only our own children. No pkill, port-based kill,
        # removal, package updates, or OS settings are used.
        for child in children:
            if child.poll() is None:child.terminate()
        for child in children:
            try:child.wait(timeout=10)
            except subprocess.TimeoutExpired:child.kill();child.wait()
        for log in logs:log.close()

if __name__=='__main__':main()

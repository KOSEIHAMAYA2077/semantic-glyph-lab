"""Fetch pinned official model data only. No remote Python is executed here."""
from pathlib import Path
import hashlib
import json
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
MODEL = ROOT / '.local/triposr-model'
MODEL.mkdir(parents=True, exist_ok=True)
REVISION = '5b521936b01fbe1890f6f9baed0254ab6351c04a'
DINO_REVISION = 'f205d5d8e640a89a2b8ef0369670dfc37cc07fc2'
WEIGHT_HASH = '429e2c6b22a0923967459de24d67f05962b235f79cde6b032aa7ed2ffcd970ee'
ARTIFACTS = [
    ('model.ckpt', f'https://huggingface.co/stabilityai/TripoSR/resolve/{REVISION}/model.ckpt', WEIGHT_HASH),
    ('config.yaml', f'https://huggingface.co/stabilityai/TripoSR/resolve/{REVISION}/config.yaml', None),
    ('dino-config.json', f'https://huggingface.co/facebook/dino-vitb16/resolve/{DINO_REVISION}/config.json', None),
    ('model-card.md', f'https://huggingface.co/stabilityai/TripoSR/resolve/{REVISION}/README.md', None),
]

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(8 * 1024 * 1024), b''): h.update(block)
    return h.hexdigest()

def main():
    records = []
    for name, url, expected in ARTIFACTS:
        path = MODEL / name
        if not path.exists():
            with urllib.request.urlopen(url, timeout=90) as response, path.open('xb') as out:
                while block := response.read(8 * 1024 * 1024): out.write(block)
        sha = digest(path)
        if expected and sha != expected:
            raise ValueError(f'Checksum mismatch: {name}; existing file retained, no overwrite attempted')
        records.append({'file': name, 'url': url, 'bytes': path.stat().st_size, 'sha256': sha,
                        'publisherLfsSha256': expected})
        print(name, path.stat().st_size, sha, flush=True)
    source = ROOT / '.local/triposr-source'
    samples = []
    for name in ('chair.png', 'horse.png', 'teapot.png'):
        path = source / 'examples' / name
        samples.append({'file': name, 'bytes': path.stat().st_size, 'sha256': digest(path),
            'source': f'https://github.com/VAST-AI-Research/TripoSR/blob/107cefdc244c39106fa830359024f6a2f1c78871/examples/{name}'})
    manifest = {'retrieved': '2026-09-30', 'model': 'stabilityai/TripoSR', 'modelRevision': REVISION,
        'code': 'https://github.com/VAST-AI-Research/TripoSR',
        'codeRevision': '107cefdc244c39106fa830359024f6a2f1c78871',
        'license': 'MIT', 'artifacts': records, 'totalModelBytes': sum(x['bytes'] for x in records),
        'inputs': samples, 'inputRedistribution': 'Not copied into public repository; retain official source links and hashes.'}
    target = ROOT / 'experiments/triposr/model-manifest.json'
    text = json.dumps(manifest, ensure_ascii=False, indent=2) + '\n'
    if target.exists():
        if target.read_text() != text: raise FileExistsError('Manifest differs; use a new filename')
    else: target.write_text(text)

if __name__ == '__main__': main()

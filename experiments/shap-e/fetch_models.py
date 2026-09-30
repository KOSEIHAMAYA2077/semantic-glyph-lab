"""Download only pinned official weights; verify hashes before any deserialization."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib, json, time, urllib.request

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / '.local/shap-e-models'
BASE = 'https://openaipublic.azureedge.net/main/shap-e/'
FILES = [
 ('vector_decoder.pt', BASE+'vector_decoder.pt', 'd7e7ebbfe3780499ae89b2da5e7c1354012dba5a6abfe295bed42f25c3be1b98'),
 ('text_cond.pt', BASE+'text_cond.pt', 'e6b4fa599a7b3c3b16c222d5f5fe56f9db9289ff0b6575fbe5c11bc97106aad4'),
 ('ViT-L-14.pt', 'https://openaipublic.azureedge.net/clip/models/b8cca3fd41ae0c99ba7e8951adf17d267cdb84cd88be6f7c2e0eca1737a03836/ViT-L-14.pt', 'b8cca3fd41ae0c99ba7e8951adf17d267cdb84cd88be6f7c2e0eca1737a03836'),
 ('vector_decoder_config.yaml', BASE+'vector_decoder_config.yaml', 'e6d373649f8e24d85925f4674b9ac41c57aba5f60e42cde6d10f87381326365c'),
 ('text_cond_config.yaml', BASE+'text_cond_config.yaml', 'f290beeea3d3e9ff15db01bde5382b6e549e463060c0744f89c049505be246c1'),
 ('diffusion_config.yaml', BASE+'diffusion_config.yaml', 'efcb2cd7ee545b2d27223979d41857802448143990572a42645cd09c2942ed57'),
]
def fetch(row):
 name,url,expected=row; target=CACHE/name; start=time.perf_counter()
 if not target.exists():
  # Exclusive creation preserves any previous attempt for inspection.
  with urllib.request.urlopen(url,timeout=60) as src, target.open('xb') as dest:
   while chunk:=src.read(1024*1024): dest.write(chunk)
 h=hashlib.sha256()
 with target.open('rb') as src:
  while chunk:=src.read(1024*1024): h.update(chunk)
 digest=h.hexdigest()
 if digest != expected: raise ValueError(f'Hash mismatch: {name}; preserved for inspection')
 result=dict(name=name,url=url,bytes=target.stat().st_size,sha256=digest,hash_verified=True,seconds=round(time.perf_counter()-start,3))
 print(json.dumps(result),flush=True)
 return result
if __name__=='__main__':
 CACHE.mkdir(parents=True,exist_ok=True)
 with ThreadPoolExecutor(max_workers=3) as pool: rows=list(pool.map(fetch,FILES))
 result={'source':'https://github.com/openai/shap-e','shap_e_commit':'50131012ee11c9d2617f3886c10f000d3c7a3b43','clip_source':'https://github.com/openai/CLIP','clip_commit':'d05afc436d78f1c48dc0dbf8e5980a9d471f35f6','license':'MIT','files':rows,'bytes':sum(x['bytes'] for x in rows)}
 out=ROOT/'experiments/shap-e/downloads.json'
 with out.open('x') as f:json.dump(result,f,indent=2)

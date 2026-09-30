"""Fetch only pinned official SDXL Turbo fp16 safetensors and JSON/tokenizer data."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib
import json
import urllib.request

ROOT=Path(__file__).resolve().parents[2]
MODEL=ROOT/'.local/text-image-sdxl-turbo'
REVISION='71153311d3dbb46851df1931d3ca6e939de83304'
MODEL_ID='stabilityai/sdxl-turbo'
ALLOWED=['LICENSE.md','README.md','model_index.json','scheduler/scheduler_config.json',
 'text_encoder/config.json','text_encoder/model.fp16.safetensors',
 'text_encoder_2/config.json','text_encoder_2/model.fp16.safetensors',
 'unet/config.json','unet/diffusion_pytorch_model.fp16.safetensors',
 'vae/config.json','vae/diffusion_pytorch_model.fp16.safetensors']
for folder in ['tokenizer','tokenizer_2']:
 for name in ['merges.txt','special_tokens_map.json','tokenizer_config.json','vocab.json']:
  ALLOWED.append(f'{folder}/{name}')

def digest(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for chunk in iter(lambda:f.read(8*1024*1024),b''):h.update(chunk)
 return h.hexdigest()

def main():
 api=f'https://huggingface.co/api/models/{MODEL_ID}/revision/{REVISION}?blobs=true'
 data=json.load(urllib.request.urlopen(api,timeout=30))
 if data['sha']!=REVISION:raise ValueError('Unexpected model revision')
 siblings={x['rfilename']:x for x in data['siblings']}
 selected=[siblings[name] for name in ALLOWED]
 total=sum(x['size'] for x in selected)
 if total>12_000_000_000:raise ValueError('Unexpected download size')
 print('planned bytes',total,flush=True)
 def fetch(item):
  name=item['rfilename'];path=MODEL/name;path.parent.mkdir(parents=True,exist_ok=True)
  url=f'https://huggingface.co/{MODEL_ID}/resolve/{REVISION}/{name}'
  if not path.exists():
   with urllib.request.urlopen(url,timeout=120) as source,path.open('xb') as out:
    while block:=source.read(8*1024*1024):out.write(block)
  sha=digest(path)
  expected=item.get('lfs',{}).get('sha256')
  if path.stat().st_size!=item['size'] or (expected and sha!=expected):
   raise ValueError(f'Checksum/size mismatch for {name}; incomplete file retained')
  print('verified',name,path.stat().st_size,flush=True)
  return {'file':name,'bytes':item['size'],'sha256':sha,'publisherLfsSha256':expected,'url':url}
 with ThreadPoolExecutor(max_workers=2) as pool:files=list(pool.map(fetch,selected))
 record={'model':MODEL_ID,'revision':REVISION,'retrieved':'2026-09-30','totalBytes':total,
  'format':'fp16 safetensors only; no Python or pickle weights fetched',
  'license':'Stability AI Community License Agreement, July 5 2024; research/noncommercial evaluation',
  'files':files}
 target=ROOT/'experiments/text-image/model-manifest.json'
 if target.exists():raise FileExistsError('Use a new manifest name for changed preparation')
 target.write_text(json.dumps(record,indent=2)+'\n')
 for source,dest in [('LICENSE.md','SDXL_TURBO_LICENSE.md')]:
  destination=ROOT/'experiments/text-image'/dest
  if not destination.exists():destination.write_bytes((MODEL/source).read_bytes())

if __name__=='__main__':main()

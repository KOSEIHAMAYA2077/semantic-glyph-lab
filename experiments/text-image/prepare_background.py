"""Small ONNX foreground model from rembg's documented release, data only."""
from pathlib import Path
import hashlib
import json
import urllib.request
ROOT=Path(__file__).resolve().parents[2]
DEST=ROOT/'.local/text-image-background/u2netp.onnx'
URL='https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx'
MD5='8e83ca70e441ab06c318d82300c84806'

def main():
 DEST.parent.mkdir(exist_ok=True)
 if not DEST.exists():
  with urllib.request.urlopen(URL,timeout=60) as source,DEST.open('xb') as target:
   while block:=source.read(1024*1024):target.write(block)
 data=DEST.read_bytes()
 if hashlib.md5(data).hexdigest()!=MD5:raise ValueError('Background model checksum mismatch')
 manifest={'date':'2026-09-30','model':'U2NETP ONNX','source':URL,'bytes':len(data),
  'sha256':hashlib.sha256(data).hexdigest(),'publisherRemBgMd5':MD5,'format':'ONNX',
  'library':'rembg 2.0.85 (existing TripoSR environment, not modified)',
  'algorithmSource':'https://github.com/xuebinqin/U-2-Net','algorithmRepoLicense':'Apache-2.0',
  'converterSource':'https://github.com/danielgatis/rembg','converterRepoLicense':'MIT'}
 target=ROOT/'experiments/text-image/background-manifest.json'
 if target.exists():raise FileExistsError('Existing manifest retained')
 target.write_text(json.dumps(manifest,indent=2)+'\n')
 print(json.dumps(manifest))

if __name__=='__main__':main()

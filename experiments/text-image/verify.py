"""Verify artifact provenance, mesh structure, and coordinate conversion without inference."""
from pathlib import Path
import argparse
import hashlib
import json
import numpy as np
import trimesh

ROOT=Path(__file__).resolve().parents[2]

def sha(path):
 return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
 p=argparse.ArgumentParser();p.add_argument('--output',required=True);args=p.parse_args()
 if not args.output.replace('-','').isalnum():raise ValueError('Simple output name required')
 report={'date':'2026-09-30','meaning':'Artifact validity is independent of semantic quality','samples':[]}
 target=ROOT/'experiments/text-image'/f'{args.output}.json'
 if target.exists():raise FileExistsError('Previous verification retained')
 for path in sorted((ROOT/'experiments/text-image').glob('mesh*/manifest.json')):
  record=json.loads(path.read_text())
  assert record['networkAttempts']==0
  for sample in record['samples']:
   if not sample.get('success'):continue
   raw=(ROOT/'public'/sample['rawPath'].lstrip('/')).resolve()
   y=(ROOT/'public'/sample['path'].lstrip('/')).resolve()
   assert raw.is_relative_to(ROOT/'public/text-image-models')
   assert y.is_relative_to(ROOT/'public/text-image-models')
   assert sha(y)==sample['sha256'] and sha(raw)==sample['rawSha256']
   assert y.stat().st_size==sample['bytes']
   original=trimesh.load(raw,force='mesh',process=False)
   converted=trimesh.load(y,force='mesh',process=False)
   assert np.isfinite(converted.vertices).all()
   assert converted.faces.min()>=0 and converted.faces.max()<len(converted.vertices)
   expected=original.vertices[:,[0,2,1]].copy();expected[:,2]*=-1
   assert np.allclose(expected,converted.vertices,atol=1e-7)
   assert np.array_equal(original.faces,converted.faces)
   report['samples'].append({'run':path.parent.name,'id':sample['id'],'sha256':sample['sha256'],'finite':True,
    'facesInRange':True,'sourceHashMatches':True,'rotationOnly':True,'vertices':len(converted.vertices),'faces':len(converted.faces)})
 with target.open('x') as f:json.dump(report,f,ensure_ascii=False,indent=2);f.write('\n')
 print(f"Verified {len(report['samples'])} artifacts, including raw-to-Y-up equivalence")

if __name__=='__main__':main()

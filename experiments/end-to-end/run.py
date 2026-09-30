"""Frozen synthetic Japanese -> one shared English description -> two local generators."""
from pathlib import Path
import argparse
import datetime
import hashlib
import io
import json
import struct
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import numpy as np
import trimesh

ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent
MAX_GLB=24*1024**2


def sha(data):return hashlib.sha256(data).hexdigest()


def call(url,timeout,data=None):
 started=time.perf_counter()
 req=Request(url,data=json.dumps(data,ensure_ascii=False).encode() if data is not None else None,
   headers={'Content-Type':'application/json','Origin':'http://127.0.0.1:4183'})
 try:
  try:response=urlopen(req,timeout=timeout)
  except HTTPError as error:response=error
  payload=response.read(MAX_GLB+1)
  return {'httpStatus':response.status,'httpSeconds':time.perf_counter()-started,
   'headers':{k:v for k,v in response.headers.items() if k.lower().startswith('x-')},'bytes':len(payload)},payload
 except (TimeoutError,URLError,OSError):
  return {'httpStatus':None,'httpSeconds':time.perf_counter()-started,'transportError':'Local request failed or timed out'},b''


def json_value(payload):
 try:return json.loads(payload)
 except (ValueError,UnicodeDecodeError):return {'error':'Response was not valid JSON'}


def mesh_metrics(data):
 if not 20<=len(data)<=MAX_GLB or struct.unpack_from('<4sII',data)!=(b'glTF',2,len(data)):
  raise ValueError('Invalid GLB envelope')
 mesh=trimesh.load(io.BytesIO(data),file_type='glb',force='mesh',process=False)
 if not len(mesh.faces) or not np.isfinite(mesh.vertices).all():raise ValueError('Mesh missing or non-finite')
 parts=mesh.split(only_watertight=False)
 return {'vertices':len(mesh.vertices),'faces':len(mesh.faces),'finite':True,
   'watertight':bool(mesh.is_watertight),'windingConsistent':bool(mesh.is_winding_consistent),
   'volume':float(mesh.volume),'bounds':mesh.bounds.tolist(),'components':len(parts),
   'largestComponentAreaShare':float(max(x.area for x in parts)/mesh.area),'sha256':sha(data),'bytes':len(data)}


def source_versions():
 names=['server/generation.py','server/image_pipeline.py','server/composition.py','src/scene.ts','src/letters.ts','src/surface-material.ts','src/body-motion.ts']
 return {name:sha((ROOT/name).read_bytes()) for name in names if (ROOT/name).is_file()}


def main():
 parser=argparse.ArgumentParser();parser.add_argument('--run',required=True);args=parser.parse_args()
 if not args.run.replace('-','').isalnum():raise ValueError('Simple unique run name required')
 raw=(HERE/'protocol.json').read_bytes();protocol=json.loads(raw)
 lock=json.loads((HERE/'protocol-lock.json').read_text())
 if sha(raw)!=lock['sha256']:raise ValueError('Frozen protocol changed')
 out=HERE/args.run;out.mkdir(exist_ok=False)
 public=ROOT/'public/end-to-end-models'/args.run;public.mkdir(parents=True,exist_ok=False)
 result={'protocolSha256':sha(raw),'date':datetime.datetime.now(datetime.timezone.utc).isoformat(),
   'sourceVersionsBefore':source_versions(),'health':{},'cases':[]}
 for item in [protocol['description'],*protocol['methods']]:
  status,payload=call(item['health'],5)
  result['health'][item['health']]={**status,'body':json_value(payload)}
  if status['httpStatus']!=200:
   result['preflightFailed']=True
   (out/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
   raise RuntimeError('A required local service is unavailable; no generation started')
 models=[];failures=[]
 def save():
  (out/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
  manifest={'date':'2026-09-30','protocol':'experiments/end-to-end/protocol.json','protocolSha256':sha(raw),
    'attribution':'Powered by Stability AI','syntheticOnly':True,'models':models,'failures':failures}
  (public/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
 for case in protocol['cases']:
  row={'id':case['id'],'text':case['text'],'methods':[]};result['cases'].append(row)
  status,payload=call(protocol['description']['url'],protocol['description']['timeoutSeconds'],{'text':case['text']})
  description=json_value(payload);row['description']={**status,'response':description}
  english=description.get('text_en') if isinstance(description,dict) else None
  if status['httpStatus']!=200 or type(english)is not str or not english.strip():
   row['skipped']='No English description; both generators skipped without correction'
   failures.append({'id':case['id'],'stage':'description','httpStatus':status['httpStatus']});save();continue
  row['text_en']=english;row['sharedEnglishSha256']=sha(english.encode())
  save()
  for method in protocol['methods']:
   print(case['id'],method['id'],'started',flush=True)
   status,payload=call(method['url'],method['timeoutSeconds'],{'text':english})
   sample={'id':method['id'],**status,'inputSha256':sha(english.encode())};row['methods'].append(sample)
   sample['endToEndSeconds']=row['description']['httpSeconds']+sample['httpSeconds']
   if status['httpStatus']==200:
    try:
     metrics=mesh_metrics(payload);sample.update(metrics)
     target=public/f"{case['id']}-{method['id']}.glb"
     with target.open('xb') as stream:stream.write(payload)
     sample['path']='/'+str(target.relative_to(ROOT/'public'))
     models.append({'id':f"e2e-{args.run}-{case['id']}-{method['id']}",'label':f"{case['text']} · {method['label']}",
       'path':sample['path'],'sha256':metrics['sha256'],'bytes':len(payload),'vertices':metrics['vertices'],'faces':metrics['faces'],
       'prompt':english,'japaneseInput':case['text'],'seed':status['headers'].get('X-Generation-Seed'),
       'sourceMethod':method['label'],'descriptionModel':description.get('model'),'semanticAssessment':'pending',
       'provenance':'Local generation from fixed synthetic input in experiments/end-to-end/protocol.json',
       'sourceLinks':(['https://github.com/openai/shap-e'] if method['id']=='shap-e' else ['https://huggingface.co/stabilityai/sdxl-turbo','https://github.com/VAST-AI-Research/TripoSR']),
       'licenseLinks':(['https://github.com/openai/shap-e/blob/main/LICENSE'] if method['id']=='shap-e' else ['https://huggingface.co/stabilityai/sdxl-turbo/blob/71153311d3dbb46851df1931d3ca6e939de83304/LICENSE.md','https://github.com/VAST-AI-Research/TripoSR/blob/107cefdc244c39106fa830359024f6a2f1c78871/LICENSE']),
       'httpSeconds':sample['httpSeconds'],'endToEndSeconds':sample['endToEndSeconds']})
    except Exception:
     sample['artifactError']='Response could not be validated as a finite GLB mesh'
     failures.append({'id':case['id'],'method':method['id'],'stage':'artifact'})
   else:
    sample['response']=json_value(payload)
    failures.append({'id':case['id'],'method':method['id'],'stage':'generation','httpStatus':status['httpStatus']})
   save();print(case['id'],method['id'],status['httpStatus'],round(status['httpSeconds'],3),flush=True)
 result['sourceVersionsAfter']=source_versions();result['sourceChangedDuringRun']=result['sourceVersionsBefore']!=result['sourceVersionsAfter']
 save()
 print('Finished; original responses retained without mesh repair or retries',flush=True)


if __name__=='__main__':main()

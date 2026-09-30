"""Offline SDXL Turbo text-to-image experiment, synthetic prompts only."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import resource
import socket
import time

ROOT=Path(__file__).resolve().parents[2]
os.environ['HF_HOME']=str(ROOT/'.local/text-image-hf')
os.environ['HF_HUB_OFFLINE']='1'
os.environ['TRANSFORMERS_OFFLINE']='1'
os.environ['HF_HUB_DISABLE_TELEMETRY']='1'
os.environ['DIFFUSERS_CACHE']=str(ROOT/'.local/text-image-hf')

import numpy as np
import torch
from diffusers import StableDiffusionXLPipeline

def digest(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for chunk in iter(lambda:f.read(8*1024*1024),b''):h.update(chunk)
 return h.hexdigest()

def main():
 p=argparse.ArgumentParser()
 p.add_argument('--run',required=True)
 p.add_argument('--steps',type=int,choices=[1,2,4],default=4)
 p.add_argument('--fixture',default='prompts-v1.json',choices=['prompts-v1.json','prompts-sword-v2.json','prompts-sword-blue-v3.json'])
 p.add_argument('--ids',nargs='+',choices=['sword','vase','twisted-vase'],default=['sword','vase','twisted-vase'])
 args=p.parse_args()
 if not args.run.replace('-','').isalnum():raise ValueError('Unique simple run name required')
 out=ROOT/'experiments/text-image'/args.run;out.mkdir(exist_ok=False)
 record={'date':'2026-09-30','device':'mps','precision':'fp16; VAE follows pipeline upcast policy',
  'steps':args.steps,'guidanceScale':0,'resolution':[512,512],'networkAttempts':0,'samples':[]}
 began=time.perf_counter()
 try:
  model=ROOT/'.local/text-image-sdxl-turbo'
  manifest=json.loads((ROOT/'experiments/text-image/model-manifest.json').read_text())
  for item in manifest['files']:
   if digest(model/item['file'])!=item['sha256']:raise ValueError('Model hash mismatch')
  index=json.loads((model/'model_index.json').read_text())
  if index['_class_name']!='StableDiffusionXLPipeline':raise ValueError('Unsupported pipeline class')
  expected={'scheduler':['diffusers','EulerAncestralDiscreteScheduler'],
   'text_encoder':['transformers','CLIPTextModel'],'text_encoder_2':['transformers','CLIPTextModelWithProjection'],
   'tokenizer':['transformers','CLIPTokenizer'],'tokenizer_2':['transformers','CLIPTokenizer'],
   'unet':['diffusers','UNet2DConditionModel'],'vae':['diffusers','AutoencoderKL']}
  for key,value in expected.items():
   if index[key]!=value:raise ValueError('Unapproved model component')
  def no_network(*a,**kw):
   record['networkAttempts']+=1
   raise RuntimeError('Network disabled during generation')
  socket.socket.connect=no_network;socket.create_connection=no_network
  torch.set_num_threads(4)
  pipe=StableDiffusionXLPipeline.from_pretrained(model,torch_dtype=torch.float16,variant='fp16',
      use_safetensors=True,local_files_only=True)
  pipe.to('mps')
  pipe.set_progress_bar_config(disable=True)
  torch.mps.synchronize();record['initializationSeconds']=time.perf_counter()-began
  record['watermarkEnabled']=pipe.watermark is not None
  fixture=ROOT/'experiments/text-image'/args.fixture
  record['fixtureSha256']=digest(fixture)
  print('initialized',round(record['initializationSeconds'],3),flush=True)
  for example in json.loads(fixture.read_text()):
   if example['id'] not in args.ids:continue
   entry=dict(example);record['samples'].append(entry)
   try:
    torch.mps.synchronize();start=time.perf_counter()
    with torch.inference_mode():
     image=pipe(prompt=example['prompt'],num_inference_steps=args.steps,guidance_scale=0,
       height=512,width=512,generator=torch.Generator('cpu').manual_seed(example['seed'])).images[0]
    torch.mps.synchronize();entry['imageSeconds']=time.perf_counter()-start
    target=out/f"{example['id']}.png";image.save(target)
    values=np.asarray(image)
    entry.update({'path':str(target.relative_to(ROOT)),'sha256':digest(target),'bytes':target.stat().st_size,
      'pixelStd':float(values.std()),'pixelMin':int(values.min()),'pixelMax':int(values.max()),
      'success':bool(values.std()>2)})
    if not entry['success']:entry['error']='Nearly uniform output; inspect image before reconstruction'
   except Exception as e:entry.update({'success':False,'error':f'{type(e).__name__}: {str(e).replace(str(ROOT),"<repo>")}'})
   print(json.dumps(entry),flush=True)
   (out/'manifest.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
 except Exception as e:
  record['error']=f'{type(e).__name__}: {str(e).replace(str(ROOT),"<repo>")}'
  print(record['error'],flush=True)
 finally:
  record['totalSeconds']=time.perf_counter()-began
  record['peakRssBytes']=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
  if torch.backends.mps.is_available():record['mpsDriverBytes']=torch.mps.driver_allocated_memory()
  (out/'manifest.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')

if __name__=='__main__':main()

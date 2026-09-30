"""Generated image -> local foreground mask -> TripoSR -> raw/Y-up GLB.

Run with the existing TripoSR interpreter; no package or old experiment is modified.
"""
from pathlib import Path
import argparse
import json
import os
import resource
import socket
import sys
import time

ROOT=Path(__file__).resolve().parents[2]
sys.dont_write_bytecode=True
sys.path.insert(0,str(ROOT/'experiments/triposr'))
from mac_runner import load_upstream,digest,measures
for key,suffix in [('HF_HOME','hf'),('MPLCONFIGDIR','mpl'),('NUMBA_CACHE_DIR','numba'),('U2NET_HOME','background')]:
 os.environ[key]=str(ROOT/f'.local/text-image-{suffix}')
os.environ['HF_HUB_OFFLINE']='1';os.environ['TRANSFORMERS_OFFLINE']='1';os.environ['OMP_NUM_THREADS']='4'

import numpy as np
import torch
import trimesh
from PIL import Image
from omegaconf import OmegaConf
import rembg

def main():
 p=argparse.ArgumentParser()
 p.add_argument('--images',required=True,help='Image run directory under experiments/text-image')
 p.add_argument('--run',required=True)
 p.add_argument('--background',choices=['u2netp','none','white-border'],default='u2netp')
 p.add_argument('--device',choices=['cpu','mps'],default='mps')
 args=p.parse_args()
 if not all(n.replace('-','').isalnum() for n in [args.run,args.images]):raise ValueError('Simple run names required')
 out=ROOT/'experiments/text-image'/args.run;out.mkdir(exist_ok=False)
 public=ROOT/'public/text-image-models'/args.run;public.mkdir(parents=True,exist_ok=False)
 record={'date':'2026-09-30','pipeline':'SDXL Turbo -> optional U2NETP -> TripoSR',
  'background':args.background,'device':args.device,'grid':128,'networkAttempts':0,'samples':[]}
 began=time.perf_counter()
 def sync():
  if args.device=='mps':torch.mps.synchronize()
 try:
  image_manifest_path=ROOT/'experiments/text-image'/args.images/'manifest.json'
  images=json.loads(image_manifest_path.read_text())
  record['imageManifestSha256']=digest(image_manifest_path)
  model_dir=ROOT/'.local/triposr-model'
  m=json.loads((ROOT/'experiments/triposr/model-manifest.json').read_text())
  for item in m['artifacts']:
   if digest(model_dir/item['file'])!=item['sha256']:raise ValueError('TripoSR hash mismatch')
  if args.background=='u2netp':
   bg=json.loads((ROOT/'experiments/text-image/background-manifest.json').read_text())
   if digest(ROOT/'.local/text-image-background/u2netp.onnx')!=bg['sha256']:raise ValueError('Background model hash mismatch')
  def no_network(*a,**kw):
   record['networkAttempts']+=1
   raise RuntimeError('Network prohibited during reconstruction')
  socket.socket.connect=no_network;socket.create_connection=no_network
  torch.set_num_threads(4)
  TSR=load_upstream()
  from tsr.utils import resize_foreground
  session=rembg.new_session('u2netp',providers=['CPUExecutionProvider']) if args.background=='u2netp' else None
  cfg=OmegaConf.load(model_dir/'config.yaml');OmegaConf.resolve(cfg)
  model=TSR(cfg)
  state=torch.load(model_dir/'model.ckpt',map_location='cpu',weights_only=True)
  model.load_state_dict(state,strict=True);del state
  model.eval().to(args.device);model.renderer.set_chunk_size(8192)
  sync();record['initializationSeconds']=time.perf_counter()-began
  for image_entry in images['samples']:
   if not image_entry.get('success'):continue
   entry={'id':image_entry['id'],'subject':image_entry['subject'],'prompt':image_entry['prompt'],
    'seed':image_entry['seed'],'imageSeconds':image_entry['imageSeconds'],'imagePath':image_entry['path']}
   record['samples'].append(entry)
   try:
    path=(ROOT/image_entry['path']).resolve()
    if not path.is_relative_to(ROOT/'experiments/text-image'):raise ValueError('Image outside experiment')
    if digest(path)!=image_entry['sha256']:raise ValueError('Input image hash mismatch')
    start=time.perf_counter();image=Image.open(path).convert('RGB')
    if session is not None or args.background=='white-border':
     if session is not None:
      rgba=rembg.remove(image,session=session)
     else:
      from scipy.ndimage import binary_propagation
      rgb=np.asarray(image)
      # Only neutral, bright background connected to the image border is removed.
      # Preserve enclosed bright regions, and do not infer an object from blue alone.
      candidates=(rgb.min(axis=2)>200)&(np.ptp(rgb,axis=2)<45)
      seeds=np.zeros_like(candidates);seeds[0]=candidates[0];seeds[-1]=candidates[-1]
      seeds[:,0]=candidates[:,0];seeds[:,-1]=candidates[:,-1]
      background=binary_propagation(seeds,mask=candidates)
      rgba=Image.fromarray(np.dstack([rgb,(~background).astype(np.uint8)*255]))
      entry['backgroundRule']={'minChannelExclusive':200,'maxChromaExclusive':45,'borderConnected':True}
     rgba.save(out/f"{entry['id']}-foreground.png")
     a=np.asarray(rgba)[:,:,3]
     entry['foregroundFraction']=float((a>127).mean())
     image=resize_foreground(rgba,.85)
     values=np.asarray(image,dtype=np.float32)/255
     image=Image.fromarray((255*(values[:,:,:3]*values[:,:,3:4]+.5*(1-values[:,:,3:4]))).astype(np.uint8))
    image.save(out/f"{entry['id']}-input.png")
    entry['preprocessSeconds']=time.perf_counter()-start
    sync();start=time.perf_counter()
    with torch.inference_mode():codes=model([image],device=args.device)
    sync();entry['reconstructSeconds']=time.perf_counter()-start
    latent=ROOT/'.local/text-image-latents'/f"{args.run}-{entry['id']}.pt";latent.parent.mkdir(exist_ok=True)
    torch.save(codes.detach().cpu(),latent)
    start=time.perf_counter()
    with torch.inference_mode():mesh=model.extract_mesh(codes,False,resolution=128)[0]
    sync();entry['extractionSeconds']=time.perf_counter()-start
    raw=public/f"{entry['id']}-z-up.glb";mesh.export(raw)
    y=mesh.copy();y.apply_transform(trimesh.transformations.rotation_matrix(-np.pi/2,[1,0,0]))
    target=public/f"{entry['id']}-y-up.glb";y.export(target)
    inspected=trimesh.load(target,force='mesh');entry.update(measures(inspected))
    entry.update({'success':True,'path':'/'+str(target.relative_to(ROOT/'public')),
     'rawPath':'/'+str(raw.relative_to(ROOT/'public')),'sha256':digest(target),'rawSha256':digest(raw),
     'bytes':target.stat().st_size,'latentSha256':digest(latent)})
    entry['sumStageSeconds']=sum(entry[k] for k in ['imageSeconds','preprocessSeconds','reconstructSeconds','extractionSeconds'])
   except Exception as e:entry.update({'success':False,'error':f'{type(e).__name__}: {str(e).replace(str(ROOT),"<repo>")}'})
   print(json.dumps(entry),flush=True)
   (out/'manifest.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
 except Exception as e:
  record['error']=f'{type(e).__name__}: {str(e).replace(str(ROOT),"<repo>")}'
  print(record['error'],flush=True)
 finally:
  record['totalSeconds']=time.perf_counter()-began
  record['peakRssBytes']=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
  if args.device=='mps' and torch.backends.mps.is_available():record['mpsDriverBytes']=torch.mps.driver_allocated_memory()
  (out/'manifest.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')

if __name__=='__main__':main()

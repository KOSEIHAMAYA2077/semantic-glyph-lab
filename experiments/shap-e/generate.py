"""Pinned Shap-E baseline. No prompts leave this process; writes new assets only."""
from pathlib import Path
import argparse, gc, hashlib, json, platform, resource, threading, time, traceback
import numpy as np
import psutil
import torch
import trimesh
import yaml
from skimage.measure import marching_cubes

ROOT=Path(__file__).resolve().parents[2]
CACHE=ROOT/'.local/shap-e-models'
PUBLIC=ROOT/'public/generated'
EXPERIMENT=ROOT/'experiments/shap-e'
PROMPTS={
 'sword':'a medieval sword with a long straight blade and a crossguard',
 'vase':'a tall ceramic vase with a narrow neck and a round body',
 'sphere':'a perfectly round sphere',
 'cube':'a plain cube',
 'twisted-vase':'a twisted ceramic vase with a spiral body',
}

def sha(path):
 h=hashlib.sha256()
 with Path(path).open('rb') as f:
  while b:=f.read(1024*1024):h.update(b)
 return h.hexdigest()

def checked_files():
 data=json.loads((EXPERIMENT/'downloads.json').read_text())
 for row in data['files']:
  if sha(CACHE/row['name'])!=row['sha256']:raise ValueError('Unverified weight: '+row['name'])
 return data

def configure_clip():
 # CLIP's upstream weight is TorchScript, not a plain tensor archive. Only the
 # exact official SHA256 is accepted; extract tensors, then use reviewed eager
 # architecture. No model-supplied forward graph is executed for inference.
 import clip
 from clip.model import build_model
 from clip.clip import _transform
 def local_clip(name,device='cpu',jit=False,download_root=None):
  if name!='ViT-L/14' or jit:raise ValueError('Only verified eager ViT-L/14 supported')
  archive=torch.jit.load(str(CACHE/'ViT-L-14.pt'),map_location='cpu')
  state=archive.state_dict()
  model=build_model(state).float().to(device).eval()
  preprocess=_transform(model.visual.input_resolution)
  del state,archive
  return model,preprocess
 clip.load=local_clip

def load_model(name,device):
 from shap_e.models.configs import model_from_config
 names={'decoder':('vector_decoder_config.yaml','vector_decoder.pt'), 'text300M':('text_cond_config.yaml','text_cond.pt')}
 config_file,weight_file=names[name]
 config=yaml.safe_load((CACHE/config_file).read_text())
 model=model_from_config(config,device=device)
 state=torch.load(CACHE/weight_file,map_location='cpu',weights_only=True)
 if not isinstance(state,dict) or not all(isinstance(v,torch.Tensor) for v in state.values()):raise TypeError('Tensor-only checkpoint required')
 model.load_state_dict(state)
 del state
 model.eval()
 return model

def synchronize(device):
 if device.type=='mps':torch.mps.synchronize()

@torch.no_grad()
def extract(decoder,latent,grid,chunk):
 from shap_e.models.query import Query
 from shap_e.util.collections import AttrDict
 device=latent.device
 params=decoder.bottleneck_to_params(latent[None])
 axis=torch.linspace(-1,1,grid,device=device)
 points=torch.stack(torch.meshgrid(axis,axis,axis,indexing='ij'),dim=-1).reshape(-1,3)
 values=[]
 for start in range(0,len(points),chunk):
  distance=decoder.renderer.get_signed_distance(Query(position=points[start:start+chunk][None]),params,AttrDict(rendering_mode='stf'))
  values.append(distance.float().reshape(-1).cpu().numpy())
  if start==0 or start//chunk % 32==0:print(f'decoding {start+min(chunk,len(points)-start)}/{len(points)}',flush=True)
 field=np.concatenate(values).reshape((grid,)*3)
 if not np.isfinite(field).all():raise ValueError('Nonfinite signed-distance field')
 if not field.min()<0<field.max():raise ValueError('No zero crossing')
 # Match official negative border convention while using CPU marching cubes.
 padded=np.pad(field,1,mode='constant',constant_values=-1)
 vertices,faces,_,_=marching_cubes(padded,level=0,spacing=(2/(grid-1),)*3,gradient_direction='ascent')
 vertices-=1+2/(grid-1)
 # Shap-E samples are Z-up. Export GLB in Y-up coordinates for the shared viewer.
 vertices=vertices[:,[0,2,1]]*np.array([1,1,-1])
 mesh=trimesh.Trimesh(vertices=vertices,faces=faces,process=False)
 if not np.isfinite(vertices).all() or len(faces)<4 or mesh.area<=0:raise ValueError('Invalid mesh')
 return mesh,{'sdf_min':float(field.min()),'sdf_max':float(field.max())}

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--ids',nargs='+',choices=list(PROMPTS),default=['sword','vase','sphere','cube']);parser.add_argument('--device',choices=['mps','cpu'],default='mps');parser.add_argument('--steps',type=int,default=32);parser.add_argument('--grid',type=int,default=64);parser.add_argument('--seed',type=int,default=20260930);parser.add_argument('--run',default='mps32-grid64');args=parser.parse_args()
 run_dir=EXPERIMENT/args.run;run_dir.mkdir(exist_ok=False)
 run_start=time.perf_counter();provenance=checked_files();configure_clip()
 device=torch.device(args.device)
 print('runtime',platform.machine(),torch.__version__,'mps',torch.backends.mps.is_available(),flush=True)
 if device.type=='mps' and not torch.backends.mps.is_available():raise RuntimeError('MPS unavailable')
 from shap_e.diffusion.sample import sample_latents
 from shap_e.diffusion.gaussian_diffusion import diffusion_from_config
 if device.type=='mps':
  from mps_compat import enable
  enable()
 torch.set_num_threads(6)
 memory={'peak_rss_bytes':0};stop=threading.Event()
 def watch():
  proc=psutil.Process()
  while not stop.wait(.25):memory['peak_rss_bytes']=max(memory['peak_rss_bytes'],proc.memory_info().rss)
 thread=threading.Thread(target=watch,daemon=True);thread.start()
 print('load text model',flush=True);model=load_model('text300M',device)
 print('load decoder',flush=True);decoder=load_model('decoder',device)
 diffusion=diffusion_from_config(yaml.safe_load((CACHE/'diffusion_config.yaml').read_text()))
 synchronize(device);load_seconds=time.perf_counter()-run_start
 rows=[]
 for index,id in enumerate(args.ids):
  output=PUBLIC/f'shap-e-{id}-{args.run}.glb'
  if output.exists():raise FileExistsError(output)
  seed=args.seed+index;torch.manual_seed(seed);np.random.seed(seed)
  prompt=PROMPTS[id];start=time.perf_counter();print('BEGIN',id,prompt,flush=True)
  row={'id':f'shap-e-{id}-{args.run}','object':id,'prompt':prompt,'provider':'shap-e','format':'glb','seed':seed,'device':args.device,'steps':args.steps,'grid':args.grid}
  try:
   with torch.no_grad():
    latents=sample_latents(batch_size=1,model=model,diffusion=diffusion,guidance_scale=15.,model_kwargs={'texts':[prompt]},progress=True,clip_denoised=True,use_fp16=False,use_karras=True,karras_steps=args.steps,sigma_min=1e-3,sigma_max=160,s_churn=0,device=device)
   synchronize(device);sample_seconds=time.perf_counter()-start
   if not torch.isfinite(latents).all():raise ValueError('Nonfinite latent')
   torch.save(latents.cpu(),run_dir/f'{id}-latent.pt')
   mesh,field_stats=extract(decoder,latents[0],args.grid,8192)
   synchronize(device)
   data=mesh.export(file_type='glb')
   with output.open('xb') as f:f.write(data)
   # Validate a fresh load of the serialized result, not only the in-memory mesh.
   recovered=trimesh.load(output,force='mesh',process=False)
   if len(recovered.faces)!=len(mesh.faces):raise ValueError('Round-trip face mismatch')
   row.update(status='ok',path='/generated/'+output.name,seconds=round(time.perf_counter()-start,3),sample_seconds=round(sample_seconds,3),vertices=len(mesh.vertices),faces=len(mesh.faces),bounds=mesh.bounds.tolist(),area=float(mesh.area),volume=float(mesh.volume),watertight=bool(mesh.is_watertight),winding_consistent=bool(mesh.is_winding_consistent),components=len(mesh.split(only_watertight=False)),sha256=sha(output),bytes=output.stat().st_size,**field_stats)
  except Exception as e:
   row.update(status='failed',seconds=round(time.perf_counter()-start,3),error=repr(e));(run_dir/f'{id}-error.txt').write_text(traceback.format_exc());print(traceback.format_exc(),flush=True)
  row['process_peak_rss_bytes_so_far']=memory['peak_rss_bytes']
  if device.type=='mps':row['mps_driver_allocated_bytes_after']=torch.mps.driver_allocated_memory()
  rows.append(row)
  with (run_dir/f'{id}.json').open('x') as f:json.dump(row,f,indent=2)
  print('RESULT',json.dumps(row),flush=True)
  gc.collect()
 stop.set();thread.join(timeout=2)
 result={'run':args.run,'runtime':{'python':platform.python_version(),'torch':torch.__version__,'architecture':platform.machine(),'device':args.device},'load_seconds':round(load_seconds,3),'total_seconds':round(time.perf_counter()-run_start,3),**memory,'models_bytes':provenance['bytes'],'assets':rows}
 with (run_dir/'manifest.json').open('x') as f:json.dump(result,f,indent=2)
 print('FINISHED',json.dumps(result),flush=True)
if __name__=='__main__':main()

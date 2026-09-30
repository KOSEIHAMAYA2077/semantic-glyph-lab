"""Re-extract cached latents at a finer grid, preserving all earlier assets."""
from pathlib import Path
import argparse,gc,json,time
import numpy as np
import torch,trimesh
from generate import ROOT,PUBLIC,EXPERIMENT,checked_files,load_model,extract,synchronize,sha
parser=argparse.ArgumentParser();parser.add_argument('source');parser.add_argument('--grid',type=int,default=128);parser.add_argument('--run',default='mps32-grid128-refined');args=parser.parse_args()
source=EXPERIMENT/args.source;folder=EXPERIMENT/args.run;folder.mkdir(exist_ok=False)
checked_files();device=torch.device('mps');start=time.perf_counter();decoder=load_model('decoder',device);synchronize(device);load_seconds=time.perf_counter()-start
rows=[]
for original in json.loads((source/'manifest.json').read_text())['assets']:
 if original['status']!='ok':continue
 id=original['object'];print('BEGIN',id,flush=True);start=time.perf_counter()
 latent=torch.load(source/f'{id}-latent.pt',map_location='cpu',weights_only=True).to(device)
 mesh,stats=extract(decoder,latent[0],args.grid,8192);synchronize(device)
 output=PUBLIC/f'shap-e-{id}-{args.run}.glb'
 with output.open('xb') as f:f.write(mesh.export(file_type='glb'))
 recovered=trimesh.load(output,force='mesh',process=False)
 assert len(recovered.faces)==len(mesh.faces) and np.isfinite(recovered.vertices).all()
 seconds=time.perf_counter()-start
 row={**original,'id':f'shap-e-{id}-{args.run}','path':'/generated/'+output.name,'grid':args.grid,'refined_from':original['id'],'refinement_seconds':round(seconds,3),'seconds':round(original['sample_seconds']+seconds,3),'vertices':len(mesh.vertices),'faces':len(mesh.faces),'bounds':mesh.bounds.tolist(),'area':float(mesh.area),'volume':float(mesh.volume),'watertight':bool(mesh.is_watertight),'winding_consistent':bool(mesh.is_winding_consistent),'components':len(mesh.split(only_watertight=False)),'sha256':sha(output),'bytes':output.stat().st_size,**stats}
 rows.append(row)
 with (folder/f'{id}.json').open('x') as f:json.dump(row,f,indent=2)
 print('RESULT',json.dumps(row),flush=True);gc.collect()
result={'run':args.run,'load_seconds':round(load_seconds,3),'note':'Only mesh extraction rerun. seconds combines prior sampling with current extraction, not a new end-to-end timer. Memory fields are from source sampling run.','source':args.source,'assets':rows}
with (folder/'manifest.json').open('x') as f:json.dump(result,f,indent=2)

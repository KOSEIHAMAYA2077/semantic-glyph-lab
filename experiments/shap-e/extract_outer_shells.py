"""Create explicit display derivatives, preserving every raw generated mesh.

Only these single-object artificial examples are eligible. This heuristic is
not valid for arbitrary multi-part assets such as chains, assemblies or scenes.
"""
from pathlib import Path
import json,time
import numpy as np
import trimesh
from generate import ROOT,EXPERIMENT,PUBLIC,sha

source_run='mps32-grid128-refined'
run='outer-shells-v1'
folder=EXPERIMENT/run
folder.mkdir(exist_ok=False)
source=json.loads((EXPERIMENT/source_run/'manifest.json').read_text())
rows=[]
for original in source['assets']:
 if original['object'] not in ['sword','vase','sphere','cube']:continue
 start=time.perf_counter()
 mesh=trimesh.load(ROOT/'public'/original['path'].lstrip('/'),force='mesh',process=False)
 components=mesh.split(only_watertight=False)
 # Negative-volume components have inward winding: for these fields they are
 # cavity boundaries, not the outer skin. Among closed positive-volume shells,
 # choose the one with largest surface area. Record every excluded component.
 candidates=[m for m in components if m.is_watertight and m.is_winding_consistent and m.volume>0]
 if not candidates:raise ValueError('No closed, positive-volume outer-shell candidate')
 selected=max(candidates,key=lambda m:m.area)
 output=PUBLIC/f"shap-e-{original['object']}-outer-shell-v1.glb"
 with output.open('xb') as f:f.write(selected.export(file_type='glb'))
 check=trimesh.load(output,force='mesh',process=False)
 assert np.isfinite(check.vertices).all() and check.is_watertight and check.volume>0
 row={**original,'id':f"shap-e-{original['object']}-outer-shell-v1",'label':f"Shap-E · {original['object']} · 128³ · outer shell",'path':'/generated/'+output.name,'run':run,'derived_from':original['id'],'derivation':'Largest-area watertight, winding-consistent component with positive signed volume. Explicit single-object display derivative; not a general asset cleanup rule.','postprocess_seconds':round(time.perf_counter()-start,3),'vertices':len(selected.vertices),'faces':len(selected.faces),'bounds':selected.bounds.tolist(),'area':float(selected.area),'volume':float(selected.volume),'watertight':bool(selected.is_watertight),'winding_consistent':bool(selected.is_winding_consistent),'components':1,'source_components':len(components),'retained_area_fraction':float(selected.area/mesh.area),'sha256':sha(output),'bytes':output.stat().st_size,'license':'Generated with MIT-licensed OpenAI Shap-E','research_note':'One explicitly selected outer component; secondary parts and cavity shells omitted only in this derivative.'}
 rows.append(row)
 with (folder/f"{original['object']}.json").open('x') as f:json.dump(row,f,indent=2)
 print(row['id'],'components',len(components),'->1','retained area',round(row['retained_area_fraction'],5),'faces',row['faces'],flush=True)
with (folder/'manifest.json').open('x') as f:json.dump({'run':run,'assets':rows},f,indent=2)
manifest_path=PUBLIC/'manifest.json'
previous=manifest_path.read_text()
with (folder/'public-manifest-before.json').open('x') as f:f.write(previous)
manifest=json.loads(previous);manifest['models'].extend(rows)
manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
print('Public manifest:',len(manifest['models']),'models')

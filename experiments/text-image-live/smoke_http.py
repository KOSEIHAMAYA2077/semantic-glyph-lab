"""One explicit synthetic HTTP experiment; keep GLB in memory, save only metrics/views."""
from pathlib import Path
import argparse
import hashlib
import io
import json
import os
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError

ROOT=Path(__file__).resolve().parents[2]
os.environ['MPLCONFIGDIR']=str(ROOT/'.local/image-pipeline-runtime/mpl')
import numpy as np
import trimesh
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection


def main():
 p=argparse.ArgumentParser();p.add_argument('--run',required=True);args=p.parse_args()
 if not args.run.replace('-','').isalnum():raise ValueError('Simple run name required')
 out=ROOT/'experiments/text-image-live'/args.run;out.mkdir(exist_ok=False)
 prompt='a simple ceramic vase'
 result={'date':'2026-09-30','syntheticPrompt':prompt,'port':4187,'service':'local SDXL Turbo -> U2NETP -> TripoSR',
   'rawGlbSaved':False,'sourceImageSaved':False}
 began=time.perf_counter()
 req=Request('http://127.0.0.1:4187/generate',data=json.dumps({'text':prompt}).encode(),
   headers={'Content-Type':'application/json','Origin':'http://127.0.0.1:4183'})
 try:response=urlopen(req,timeout=130)
 except HTTPError as error:response=error
 data=response.read();result.update(httpStatus=response.status,httpSeconds=time.perf_counter()-began,
   headers={k:v for k,v in response.headers.items() if k.lower().startswith('x-')},bytes=len(data))
 if response.status!=200:
  result['error']=json.loads(data)
 else:
  mesh=trimesh.load(io.BytesIO(data),file_type='glb',force='mesh',process=False)
  result.update(sha256=hashlib.sha256(data).hexdigest(),vertices=len(mesh.vertices),faces=len(mesh.faces),
    finite=bool(np.isfinite(mesh.vertices).all()),watertight=bool(mesh.is_watertight),
    windingConsistent=bool(mesh.is_winding_consistent),bounds=mesh.bounds.tolist(),components=len(mesh.split(only_watertight=False)))
  fig=plt.figure(figsize=(12,4.5),facecolor='#080808')
  # Y-up GLB becomes Z-up only for these matplotlib views; the response remains unchanged.
  mesh.apply_transform(trimesh.transformations.rotation_matrix(np.pi/2,[1,0,0]))
  light=np.array([.4,-.3,.86]);light/=np.linalg.norm(light)
  level=.25+.7*np.clip(mesh.face_normals@light,0,1);colors=np.stack([level,level,level,np.ones_like(level)],axis=-1)
  for n,angle in enumerate([35,145,255],1):
   ax=fig.add_subplot(1,3,n,projection='3d',facecolor='#080808')
   ax.add_collection3d(Poly3DCollection(mesh.vertices[mesh.faces],facecolors=colors,linewidths=0,rasterized=True))
   center=mesh.bounds.mean(0);radius=np.max(mesh.extents)*.56
   ax.set_xlim(center[0]-radius,center[0]+radius);ax.set_ylim(center[1]-radius,center[1]+radius);ax.set_zlim(center[2]-radius,center[2]+radius)
   ax.set_box_aspect((1,1,1));ax.view_init(elev=25,azim=angle);ax.set_axis_off();ax.set_title(f'{angle} degrees',color='#dddddd')
  fig.suptitle('Local text -> image -> mesh | a simple ceramic vase',color='#eeeeee',fontsize=14)
  fig.subplots_adjust(left=.01,right=.99,bottom=.015,top=.84,wspace=.025)
  fig.savefig(out/'views.png',dpi=140,facecolor=fig.get_facecolor());plt.close(fig)
 (out/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps(result,ensure_ascii=False))


if __name__=='__main__':main()

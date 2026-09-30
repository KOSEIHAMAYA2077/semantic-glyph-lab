"""Compare generated images, masks, and 3D views without overwriting a prior figure."""
from pathlib import Path
import argparse
import json
import os
ROOT=Path(__file__).resolve().parents[2]
os.environ['MPLCONFIGDIR']=str(ROOT/'.local/text-image-mpl')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
from PIL import Image
import numpy as np
import trimesh

def main():
 p=argparse.ArgumentParser();p.add_argument('--run',required=True);p.add_argument('--output',default='comparison');args=p.parse_args()
 if not args.run.replace('-','').isalnum():raise ValueError('Simple run name required')
 if not args.output.replace('-','').isalnum():raise ValueError('Simple output name required')
 run=ROOT/'experiments/text-image'/args.run
 record=json.loads((run/'manifest.json').read_text())
 entries=[x for x in record['samples'] if x.get('success')]
 target=run/f'{args.output}.png'
 if target.exists():raise FileExistsError('Existing comparison retained')
 fig=plt.figure(figsize=(14,3.4*len(entries)+.4),facecolor='#080808')
 for row,item in enumerate(entries):
  for col,(path,label) in enumerate([(ROOT/item['imagePath'],'generated image'),(run/f"{item['id']}-input.png",'TripoSR input')]):
   ax=fig.add_subplot(len(entries),4,row*4+col+1,facecolor='#080808')
   ax.imshow(Image.open(path));ax.axis('off');ax.set_title(f"{item['id']} | {label}",color='#dddddd',fontsize=11)
  mesh=trimesh.load(ROOT/'public'/item['rawPath'].lstrip('/'),force='mesh')
  light=np.array([.4,-.3,.86]);light/=np.linalg.norm(light)
  level=.3+.65*np.clip(mesh.face_normals@light,0,1)
  colors=np.stack([level,level,level,np.ones_like(level)],axis=-1)
  for col,angle in enumerate([45,155],start=2):
   ax=fig.add_subplot(len(entries),4,row*4+col+1,projection='3d',facecolor='#080808')
   ax.add_collection3d(Poly3DCollection(mesh.vertices[mesh.faces],facecolors=colors,linewidths=0,rasterized=True))
   center=mesh.bounds.mean(0);r=np.max(mesh.extents)*.55
   ax.set_xlim(center[0]-r,center[0]+r);ax.set_ylim(center[1]-r,center[1]+r);ax.set_zlim(center[2]-r,center[2]+r)
   ax.set_box_aspect((1,1,1));ax.view_init(elev=20,azim=angle);ax.set_axis_off()
   ax.set_title(f'geometry | {angle} degrees',color='#dddddd',fontsize=11)
 background={'u2netp':'U2NETP','none':'raw RGB','white-border':'border-connected white removal'}[record['background']]
 fig.suptitle(f'SDXL Turbo -> {background} -> TripoSR | synthetic research examples',color='#eeeeee',fontsize=15)
 fig.subplots_adjust(left=.01,right=.99,bottom=.015,top=.80 if len(entries)==1 else .92,wspace=.025,hspace=.16)
 fig.savefig(target,dpi=140,facecolor=fig.get_facecolor());plt.close(fig)
 print(target.relative_to(ROOT))

if __name__=='__main__':main()

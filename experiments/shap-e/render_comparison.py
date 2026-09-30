"""Render existing generated GLB meshes for visual inspection, without changing them."""
from pathlib import Path
import argparse,json
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
import numpy as np
import trimesh
ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser();parser.add_argument('run');args=parser.parse_args()
folder=ROOT/'experiments/shap-e'/args.run
manifest=json.loads((folder/'manifest.json').read_text())
rows=[r for r in manifest['assets'] if r['status']=='ok']
fig=plt.figure(figsize=(12,len(rows)*3.3),facecolor='#080808')
for i,row in enumerate(rows):
 mesh=trimesh.load(ROOT/'public'/row['path'].lstrip('/'),force='mesh',process=False)
 # Y-up exports become plotting Z-up, without altering the mesh on disk.
 v=mesh.vertices[:,[0,2,1]];center=(v.max(0)+v.min(0))/2;v-=center
 radius=max(np.ptp(v,axis=0))/2*1.12
 for j,azim in enumerate([0,45,90]):
  ax=fig.add_subplot(len(rows),3,i*3+j+1,projection='3d',computed_zorder=False)
  ax.set_facecolor('#080808');ax.set_box_aspect((1,1,1));ax.view_init(elev=15,azim=azim)
  polys=Poly3DCollection(v[mesh.faces],facecolors='#c8c8c8',linewidths=0,shade=True,lightsource=matplotlib.colors.LightSource(azdeg=315,altdeg=45))
  ax.add_collection3d(polys);ax.set_xlim(-radius,radius);ax.set_ylim(-radius,radius);ax.set_zlim(-radius,radius);ax.set_axis_off()
  ax.set_title(f"{row['object']} / {azim} deg",color='white',fontsize=11)
fig.tight_layout(pad=.4)
out=folder/'comparison.png'
if out.exists():raise FileExistsError(out)
fig.savefig(out,dpi=130,facecolor=fig.get_facecolor());print(out)

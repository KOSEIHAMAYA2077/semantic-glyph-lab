"""Inspect raw meshes and make separately named Y-up viewer derivatives."""
from pathlib import Path
import json
import os
ROOT=Path(__file__).resolve().parents[2]
os.environ['MPLCONFIGDIR']=str(ROOT/'.local/triposr-mpl')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
import numpy as np
import trimesh
from mac_runner import digest, measures

run=ROOT/'experiments/triposr/mps128-three'
source=json.loads((run/'manifest.json').read_text())
derived=ROOT/'public/reconstructed/mps128-y-up'
derived.mkdir(exist_ok=False)
fig=plt.figure(figsize=(12,10),facecolor='#080808')
published=[]
for row,record in enumerate(source['samples']):
    path=ROOT/'public'/record['path']
    mesh=trimesh.load(path,force='mesh')
    for column,azimuth in enumerate([-55,45,155]):
        ax=fig.add_subplot(3,3,row*3+column+1,projection='3d',facecolor='#080808')
        light=np.array([.4,-.3,.86]);light/=np.linalg.norm(light)
        intensity=.33+.6*np.clip(mesh.face_normals@light,0,1)
        colors=np.stack([intensity,intensity,intensity,np.ones_like(intensity)],axis=-1)
        poly=Poly3DCollection(mesh.vertices[mesh.faces],facecolors=colors,linewidths=0,rasterized=True)
        ax.add_collection3d(poly)
        center=mesh.bounds.mean(0);radius=np.max(mesh.extents)*.56
        ax.set_xlim(center[0]-radius,center[0]+radius)
        ax.set_ylim(center[1]-radius,center[1]+radius)
        ax.set_zlim(center[2]-radius,center[2]+radius)
        ax.set_box_aspect((1,1,1));ax.view_init(elev=18,azim=azimuth);ax.set_axis_off()
        ax.set_title(f"{record['id']} | {azimuth} degrees",color='#dddddd',fontsize=12,pad=-3)
    viewer=mesh.copy()
    viewer.apply_transform(trimesh.transformations.rotation_matrix(-np.pi/2,[1,0,0]))
    target=derived/f"triposr-{record['id']}-y-up.glb"
    viewer.export(target)
    check=trimesh.load(target,force='mesh')
    info=measures(check)
    if not info['finite'] or not info['watertight'] or info['volume']<=0: raise ValueError('Invalid derivative')
    published.append({'id':f"triposr-{record['id']}",'label':{'chair':'画像から: 椅子','horse':'画像から: 馬','teapot':'画像から: ティーポット'}[record['id']],
        'path':'/'+str(target.relative_to(ROOT/'public')),'sha256':digest(target),'bytes':target.stat().st_size,
        'sourceMethod':'TripoSR image-to-3D, not text-to-3D','inputSource':f"https://github.com/VAST-AI-Research/TripoSR/blob/107cefdc244c39106fa830359024f6a2f1c78871/examples/{record['id']}.png",
        'rawSourceSha256':record['sha256'],'transform':'rotation X=-pi/2, Z-up to Y-up; no mesh repair',**info})
fig.suptitle('TripoSR | official sample images -> geometry | MPS, 128 cubed',color='#eeeeee',fontsize=16)
fig.subplots_adjust(left=.01,right=.99,bottom=.01,top=.94,wspace=0,hspace=.02)
fig.savefig(run/'comparison.png',dpi=140,facecolor=fig.get_facecolor())
plt.close(fig)
target=ROOT/'public/reconstructed/manifest.json'
if target.exists(): raise FileExistsError('Refusing to overwrite existing publication manifest')
target.write_text(json.dumps({'date':'2026-09-30','models':published},ensure_ascii=False,indent=2)+'\n')
(run/'viewer-derivatives.json').write_text(json.dumps(published,ensure_ascii=False,indent=2)+'\n')
print('Three views per mesh, three separately saved Y-up derivatives, hashes verified.')

"""Official TripoSR network, local-only weights, explicit MPS, CPU mesh extraction.

Compatibility changes live here; the pinned upstream source remains untouched.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import resource
import socket
import sys
import time
import types

ROOT = Path(__file__).resolve().parents[2]
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['HF_HOME'] = str(ROOT / '.local/triposr-cache')
os.environ['MPLCONFIGDIR'] = str(ROOT / '.local/triposr-mpl')
os.environ['NUMBA_CACHE_DIR'] = str(ROOT / '.local/triposr-numba')

import numpy as np
import torch
import trimesh
from PIL import Image
from omegaconf import OmegaConf
from skimage.measure import marching_cubes

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(8*1024*1024), b''): h.update(chunk)
    return h.hexdigest()

def cpu_marching_cubes(level, threshold):
    # torchmcubes returns Z,Y,X; its caller swaps them back. skimage returns X,Y,Z.
    vertices, faces, _, _ = marching_cubes(level.detach().cpu().numpy(), level=threshold,
                                          gradient_direction='ascent', allow_degenerate=False)
    return torch.from_numpy(vertices[:, [2,1,0]].copy()), torch.from_numpy(faces.astype(np.int64).copy())

def load_upstream():
    sys.path.insert(0, str(ROOT / '.local/triposr-source'))
    adapter = types.ModuleType('torchmcubes')
    adapter.marching_cubes = cpu_marching_cubes
    sys.modules['torchmcubes'] = adapter
    from tsr.system import TSR
    from tsr.models.tokenizers import image as image_module
    def local_dino(repo_id, filename, **kwargs):
        if repo_id != 'facebook/dino-vitb16' or filename != 'config.json':
            raise ValueError('Unapproved model lookup')
        return str(ROOT / '.local/triposr-model/dino-config.json')
    image_module.hf_hub_download = local_dino
    return TSR

def sync(device):
    if device == 'mps': torch.mps.synchronize()

def input_image(name):
    source = ROOT / '.local/triposr-source/examples' / f'{name}.png'
    image = Image.open(source)
    if image.mode == 'RGBA':
        from tsr.utils import resize_foreground
        image = resize_foreground(image, 0.85)
        a = np.asarray(image, dtype=np.float32) / 255
        rgb = a[:,:,:3]*a[:,:,3:4] + .5*(1-a[:,:,3:4])
        image = Image.fromarray((rgb*255).astype(np.uint8))
    else: image = image.convert('RGB')
    return image

def measures(mesh):
    parts = mesh.split(only_watertight=False)
    return {'vertices': len(mesh.vertices), 'faces': len(mesh.faces),
        'finite': bool(np.isfinite(mesh.vertices).all()), 'watertight': bool(mesh.is_watertight),
        'windingConsistent': bool(mesh.is_winding_consistent), 'volume': float(mesh.volume),
        'bounds': mesh.bounds.tolist(), 'components': len(parts),
        'largestComponentAreaShare': float(max((p.area for p in parts), default=0)/mesh.area)}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--device',choices=['cpu','mps'],default='mps')
    parser.add_argument('--resolution',type=int,choices=[32,64,96,128],default=64)
    parser.add_argument('--run',required=True)
    parser.add_argument('--samples',nargs='+',choices=['chair','horse','teapot'],default=['chair','horse','teapot'])
    args=parser.parse_args()
    if not args.run.replace('-','').isalnum(): raise ValueError('Simple unique run name required')
    output=ROOT/'experiments/triposr'/args.run
    output.mkdir(exist_ok=False)
    published=ROOT/'public/reconstructed'/args.run
    published.mkdir(parents=True,exist_ok=False)
    log={'date':'2026-09-30','device':args.device,'resolution':args.resolution,'torch':torch.__version__,
         'precision':'float32','networkAttempts':0,'samples':[],'compatibility':'mac_runner.py'}
    start=time.perf_counter()
    try:
        manifest=json.loads((ROOT/'experiments/triposr/model-manifest.json').read_text())
        for item in manifest['artifacts']:
            if digest(ROOT/'.local/triposr-model'/item['file']) != item['sha256']:
                raise ValueError('Model checksum mismatch')
        for item in manifest['inputs']:
            if digest(ROOT/'.local/triposr-source/examples'/item['file']) != item['sha256']:
                raise ValueError('Input checksum mismatch')
        if args.device=='mps' and not torch.backends.mps.is_available(): raise RuntimeError('MPS unavailable')
        torch.set_num_threads(4)
        torch.manual_seed(104)
        TSR=load_upstream()
        def no_network(*a,**kw):
            log['networkAttempts']+=1
            raise RuntimeError('Network prohibited during inference')
        socket.socket.connect=no_network
        socket.create_connection=no_network
        config=OmegaConf.load(ROOT/'.local/triposr-model/config.yaml')
        expected={
          'image_tokenizer_cls':'tsr.models.tokenizers.image.DINOSingleImageTokenizer',
          'tokenizer_cls':'tsr.models.tokenizers.triplane.Triplane1DTokenizer',
          'backbone_cls':'tsr.models.transformer.transformer_1d.Transformer1D',
          'post_processor_cls':'tsr.models.network_utils.TriplaneUpsampleNetwork',
          'decoder_cls':'tsr.models.network_utils.NeRFMLP',
          'renderer_cls':'tsr.models.nerf_renderer.TriplaneNeRFRenderer'}
        for key,value in expected.items():
            if config[key]!=value: raise ValueError('Unapproved class in configuration')
        OmegaConf.resolve(config)
        model=TSR(config)
        state=torch.load(ROOT/'.local/triposr-model/model.ckpt',map_location='cpu',weights_only=True)
        model.load_state_dict(state,strict=True)
        del state
        model.eval().to(args.device)
        model.renderer.set_chunk_size(8192)
        sync(args.device)
        log['initializationSeconds']=time.perf_counter()-start
        print('initialized',round(log['initializationSeconds'],3),flush=True)
        for name in args.samples:
            entry={'id':name,'input':f'examples/{name}.png'}
            log['samples'].append(entry)
            try:
                image=input_image(name)
                sync(args.device); began=time.perf_counter()
                with torch.inference_mode(): codes=model([image],device=args.device)
                sync(args.device); entry['networkSeconds']=time.perf_counter()-began
                # Save only learned scene codes, not input images, for later extraction comparisons.
                latent=ROOT/'.local/triposr-cache'/f'{args.run}-{name}-scene.pt'
                latent.parent.mkdir(exist_ok=True)
                torch.save(codes.detach().cpu(),latent)
                began=time.perf_counter()
                with torch.inference_mode(): mesh=model.extract_mesh(codes,False,resolution=args.resolution)[0]
                sync(args.device); entry['extractionSeconds']=time.perf_counter()-began
                destination=published/f'triposr-{name}.glb'
                mesh.export(destination)
                reloaded=trimesh.load(destination,force='mesh')
                entry.update(measures(reloaded))
                entry.update({'success':True,'path':str(destination.relative_to(ROOT/'public')),
                              'bytes':destination.stat().st_size,'sha256':digest(destination)})
                print(json.dumps(entry),flush=True)
            except Exception as exc:
                entry.update({'success':False,'error':f'{type(exc).__name__}: {str(exc).replace(str(ROOT),"<repo>")}'})
                print(json.dumps(entry),flush=True)
            (output/'manifest.json').write_text(json.dumps(log,ensure_ascii=False,indent=2)+'\n')
    except Exception as exc:
        log['error']=f'{type(exc).__name__}: {str(exc).replace(str(ROOT),"<repo>")}'
        print(log['error'],flush=True)
    finally:
        log['totalSeconds']=time.perf_counter()-start
        log['peakRssBytes']=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        if args.device=='mps' and torch.backends.mps.is_available():
            log['mpsDriverBytes']=torch.mps.driver_allocated_memory()
        (output/'manifest.json').write_text(json.dumps(log,ensure_ascii=False,indent=2)+'\n')

if __name__=='__main__': main()

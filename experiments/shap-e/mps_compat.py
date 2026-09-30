"""Shap-E compatibility correction: cast lookup values before moving to MPS.

Upstream returns float32, but temporarily copies its NumPy float64 table to the
GPU first. Metal rejects that intermediate dtype. Preserve output arithmetic.
"""
import torch

def extract_into_tensor(arr,timesteps,broadcast_shape):
 values=torch.from_numpy(arr).float().to(device=timesteps.device)[timesteps]
 while values.ndim<len(broadcast_shape):values=values[...,None]
 return values.expand(broadcast_shape)

def enable():
 import shap_e.diffusion.gaussian_diffusion as diffusion
 diffusion._extract_into_tensor=extract_into_tensor

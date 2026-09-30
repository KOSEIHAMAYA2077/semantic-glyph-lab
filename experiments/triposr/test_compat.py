import unittest
import numpy as np
import torch
import trimesh
from mac_runner import load_upstream

load_upstream()
from tsr.models.isosurface import MarchingCubeHelper

class SurfaceAdapterTests(unittest.TestCase):
    def test_positive_interior_produces_closed_outward_surface(self):
        helper = MarchingCubeHelper(32)
        field = .3**2 - ((helper.grid_vertices-.5)**2).sum(-1)
        vertices, faces = helper(-field)
        mesh = trimesh.Trimesh(vertices.numpy(), faces.numpy())
        self.assertTrue(mesh.is_watertight)
        self.assertTrue(mesh.is_winding_consistent)
        self.assertGreater(mesh.volume, 0)
        self.assertAlmostEqual(mesh.volume, 4/3*np.pi*.3**3, delta=.002)

    def test_asymmetric_ellipsoid_keeps_axis_order_and_position(self):
        helper = MarchingCubeHelper(64)
        center = torch.tensor([.36,.52,.65])
        radii = torch.tensor([.25,.16,.09])
        field = 1 - (((helper.grid_vertices-center)/radii)**2).sum(-1)
        vertices, faces = helper(-field)
        bounds = torch.stack([vertices.amin(0),vertices.amax(0)])
        expected = torch.stack([center-radii,center+radii])
        self.assertLess(float((bounds-expected).abs().max()), .004)
        self.assertTrue(trimesh.Trimesh(vertices.numpy(),faces.numpy()).is_watertight)

if __name__ == '__main__': unittest.main()

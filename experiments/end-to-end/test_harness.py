import io
import unittest
import numpy as np
import trimesh
import run as harness


class HarnessTests(unittest.TestCase):
 def test_finite_mesh_and_invalid_responses(self):
  mesh=trimesh.creation.box(extents=[1,2,3]);data=mesh.export(file_type='glb')
  record=harness.mesh_metrics(data)
  self.assertEqual(record['faces'],12);self.assertEqual(record['components'],1)
  self.assertEqual(record['bounds'],[[-.5,-1,-1.5],[.5,1,1.5]])
  for bad in [b'',b'not a glb',data+b'x']:
   with self.assertRaises(ValueError):harness.mesh_metrics(bad)

 def test_error_body_can_be_retained_without_decode_failure(self):
  self.assertEqual(harness.json_value(b'{"error":"small foreground"}')['error'],'small foreground')
  self.assertIn('error',harness.json_value(b'\xffbad gateway'))

 def test_frozen_protocol_is_exact(self):
  import json
  raw=(harness.HERE/'protocol.json').read_bytes()
  lock=json.loads((harness.HERE/'protocol-lock.json').read_text())
  self.assertEqual(harness.sha(raw),lock['sha256'])
  plan=json.loads(raw)
  self.assertEqual([c['text'] for c in plan['cases']],['小さな帆船','開いた傘','長い注ぎ口が付いたじょうろ'])
  self.assertEqual([m['requestsPerCase'] for m in plan['methods']],[1,1])


if __name__=='__main__':unittest.main()

import { describe, expect, it } from 'vitest';
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { createForm, FORM_IDS } from './geometry';
import { DEFAULT_FORM } from './types';

describe('procedural object surfaces', () => {
  it.each(FORM_IDS)('%s provides finite, nondegenerate 3D faces with UVs and normals', object => {
    const g = createForm({ ...DEFAULT_FORM, object });
    const p = g.getAttribute('position'), uv = g.getAttribute('uv'), n = g.getAttribute('normal');
    expect(p.count).toBeGreaterThan(100);
    expect(uv.count).toBe(p.count); expect(n.count).toBe(p.count);
    for (const a of [p, uv, n]) for (let i = 0; i < a.array.length; i++) expect(Number.isFinite(a.array[i])).toBe(true);
    const index = g.getIndex()!, a = new Vector3(), b = new Vector3(), c = new Vector3();
    expect(index.count).toBeGreaterThan(300);
    for (let i = 0; i < index.count; i += 3) {
      a.fromBufferAttribute(p, index.getX(i)); b.fromBufferAttribute(p, index.getX(i + 1)); c.fromBufferAttribute(p, index.getX(i + 2));
      expect(b.sub(a).cross(c.sub(a)).lengthSq()).toBeGreaterThan(1e-16);
    }
    const size = g.boundingBox!.getSize(new Vector3());
    expect(Math.max(size.x, size.y, size.z)).toBeCloseTo(2.6, 5);
    expect(Math.min(size.x, size.y, size.z)).toBeGreaterThan(.05);
    g.dispose();
  });

  it('a square sphere broadens diagonal surface positions while retaining its axis extent', () => {
    const smooth = createForm(DEFAULT_FORM), squared = createForm({ ...DEFAULT_FORM, squareness: 1 });
    const p = smooth.getAttribute('position'), q = squared.getAttribute('position');
    let diagonal = 0, ratio = 0;
    for (let i = 0; i < p.count; i++) {
      const x = Math.abs(p.getX(i)), y = Math.abs(p.getY(i)), z = Math.abs(p.getZ(i));
      if (Math.min(x, y, z) > .6) {
        ratio += Math.hypot(q.getX(i), q.getY(i), q.getZ(i)) / Math.hypot(x, y, z); diagonal++;
      }
    }
    expect(diagonal).toBeGreaterThan(20); expect(ratio / diagonal).toBeGreaterThan(1.45);
    expect(squared.boundingBox!.max.x).toBeCloseTo(smooth.boundingBox!.max.x, 4);
    smooth.dispose(); squared.dispose();
  });

  it('elongation, twist and bend change the object continuously and do not replace its topology', () => {
    const base = createForm({ ...DEFAULT_FORM, object: 'vase' });
    const tall = createForm({ ...DEFAULT_FORM, object: 'vase', elongation: 2 });
    expect(tall.boundingBox!.getSize(new Vector3()).y).toBeCloseTo(base.boundingBox!.getSize(new Vector3()).y * 2, 5);
    const changed = createForm({ ...DEFAULT_FORM, object: 'sword', twist: .7, bend: .5, roughness: .3 });
    const sword = createForm({ ...DEFAULT_FORM, object: 'sword' });
    expect(changed.getAttribute('position').count).toBe(sword.getAttribute('position').count);
    const p = changed.getAttribute('position'), q = sword.getAttribute('position');
    let difference = 0;
    for (let i = 0; i < p.count; i++) difference += Math.abs(p.getX(i) - q.getX(i)) + Math.abs(p.getZ(i) - q.getZ(i));
    expect(difference / p.count).toBeGreaterThan(.1);
    for (const g of [base, tall, changed, sword]) g.dispose();
  });

  it('a cube is already square and does not inflate when asked for more squareness', () => {
    const cube = createForm({ ...DEFAULT_FORM, object: 'cube' });
    const squareCube = createForm({ ...DEFAULT_FORM, object: 'cube', squareness: 1 });
    expect(Array.from(squareCube.getAttribute('position').array)).toEqual(Array.from(cube.getAttribute('position').array));
    cube.dispose(); squareCube.dispose();
  });

  it('a vase has a hollow opening, and a sword retains broad guard and narrow blade', () => {
    const vase = createForm({ ...DEFAULT_FORM, object: 'vase' });
    const material = new MeshBasicMaterial({ side: DoubleSide });
    const mesh = new Mesh(vase, material); mesh.updateMatrixWorld();
    const ray = new Raycaster(new Vector3(.03, 3, .02), new Vector3(0, -1, 0));
    const hits = ray.intersectObject(mesh);
    expect(hits.length).toBeGreaterThan(0);
    // A center ray enters the mouth and first reaches the inside bottom, not a cap.
    expect(hits[0].point.y).toBeLessThan(-.8);
    const sword = createForm({ ...DEFAULT_FORM, object: 'sword' });
    const p = sword.getAttribute('position');
    let guardWidth = 0, bladeWidth = 0;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) < -.3 && p.getY(i) > -.7) guardWidth = Math.max(guardWidth, Math.abs(p.getX(i)));
      if (p.getY(i) > .3 && p.getY(i) < .7) bladeWidth = Math.max(bladeWidth, Math.abs(p.getX(i)));
    }
    expect(guardWidth).toBeGreaterThan(bladeWidth * 2);
    vase.dispose(); sword.dispose(); material.dispose();
  });

  it.each(FORM_IDS)('%s tolerates all combined deformation limits', object => {
    const g = createForm({ ...DEFAULT_FORM, object, squareness: 1, elongation: 2.5, twist: -1, bend: 1, roughness: 1, count: 8 });
    const p = g.getAttribute('position');
    expect(Array.from(p.array).every(Number.isFinite)).toBe(true);
    expect(g.boundingSphere!.radius).toBeGreaterThan(.1);
    expect(g.boundingSphere!.radius).toBeLessThan(15);
    g.dispose();
  });

  it('falls back safely for non-finite attributes and leaves replication to the renderer', () => {
    const single = createForm(DEFAULT_FORM);
    const count = createForm({ ...DEFAULT_FORM, count: 8, elongation: NaN, squareness: Infinity, twist: NaN, bend: NaN, roughness: NaN });
    expect(Array.from(count.getAttribute('position').array)).toEqual(Array.from(single.getAttribute('position').array));
    single.dispose(); count.dispose();
  });
});

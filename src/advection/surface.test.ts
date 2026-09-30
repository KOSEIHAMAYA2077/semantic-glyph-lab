import { describe, expect, it } from 'vitest';
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, SphereGeometry, Vector3 } from 'three';
import { Surface } from './surface';

describe('triangle surface advection', () => {
  it('welds sphere seams and poles into a closed adjacency graph', () => {
    const surface = new Surface(new SphereGeometry(1, 32, 24));
    expect(surface.boundaryEdges).toBe(0); expect(surface.nonManifoldEdges).toBe(0);
    expect(surface.totalArea).toBeCloseTo(4 * Math.PI, 0);
  });
  it('seeds points proportional to triangle area', () => {
    const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute([0,0,0, 1,0,0, 0,1,0, 3,0,0, 5,0,0, 3,2,0], 3));
    const surface = new Surface(g), points = surface.seed(20000, 12);
    expect(points.filter(p => p.face === 0).length / points.length).toBeCloseTo(.2, 1);
    for (const p of points.slice(0, 100)) expect(surface.distance(p.position)).toBeLessThan(1e-10);
  });
  it('transports across sharp cube corners without teleporting or drifting off the mesh', () => {
    const surface = new Surface(new BoxGeometry(2, 2, 2, 3, 3, 3)), points = surface.seed(100, 9);
    for (let frame = 0; frame < 360; frame++) {
      const before = points.map(p => p.position.clone()); surface.step(points, 1/60, frame/60, .6);
      points.forEach((p, i) => {
        expect(p.position.distanceTo(before[i])).toBeLessThanOrEqual(.010001);
        expect(Math.min(...p.bary)).toBeGreaterThanOrEqual(-1e-8);
        expect(Math.abs(p.up.dot(surface.faces[p.face].normal))).toBeLessThan(1e-6);
      });
    }
    expect(surface.crossings).toBeGreaterThan(200);
    expect(surface.boundaryStops).toBe(0); expect(surface.iterationStops).toBe(0);
    points.forEach(p => expect(surface.distance(p.position)).toBeLessThan(1e-8));
  });
  it('stops at an open boundary instead of relocating the particle', () => {
    const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute([0,0,0, 1,0,0, 0,1,0], 3));
    const surface = new Surface(g), p = surface.seed(1)[0], before = p.position.clone();
    surface.move(p, new Vector3(2, 0, 0));
    expect(surface.boundaryStops).toBe(1); expect(p.face).toBe(0);
    expect(surface.distance(p.position)).toBeLessThan(1e-8); expect(p.position.distanceTo(before)).toBeLessThan(2);
  });
});

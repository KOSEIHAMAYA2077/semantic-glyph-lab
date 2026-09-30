import { describe, expect, it } from 'vitest';
import { BoxGeometry, SphereGeometry, Vector3 } from 'three';
import { Surface } from './surface';
import { StreamField } from './stream';

describe('surface stream function', () => {
  it('has matching flux across shared edges, including sharp cube folds', () => {
    const surface = new Surface(new BoxGeometry(2, 2, 2, 3, 3, 3)), stream = new StreamField(surface);
    stream.setTime(23);
    surface.faces.forEach((face, id) => face.neighbors.forEach((adjacent, opposite) => {
      const other = surface.faces[adjacent], otherOpposite = other.neighbors.indexOf(id);
      const vertices = [face.a, face.a.clone().add(face.e1), face.a.clone().add(face.e2)];
      const otherVertices = [other.a, other.a.clone().add(other.e1), other.a.clone().add(other.e2)];
      const outward = vertices[(opposite + 2) % 3].clone().sub(vertices[(opposite + 1) % 3]).cross(face.normal);
      const otherOutward = otherVertices[(otherOpposite + 2) % 3].clone().sub(otherVertices[(otherOpposite + 1) % 3]).cross(other.normal);
      const flux = stream.field(id, new Vector3()).dot(outward) + stream.field(adjacent, new Vector3()).dot(otherOutward);
      expect(Math.abs(flux)).toBeLessThan(1e-10);
    }));
  });
  it('preserves anchors and finite orientation during continuous time integration', () => {
    const surface = new Surface(new SphereGeometry(1, 24, 16)), stream = new StreamField(surface), points = surface.seed(100, 42);
    for (let i = 0; i < 600; i++) stream.step(points, 1/60, i/60);
    expect(surface.crossings).toBeGreaterThan(100);
    expect(surface.boundaryStops).toBe(0); expect(surface.iterationStops).toBe(0);
    expect(stream.distanceTraveled / 100).toBeGreaterThan(.5);
    points.forEach(p => { expect(surface.distance(p.position)).toBeLessThan(1e-8); expect(Math.min(...p.bary)).toBeGreaterThanOrEqual(-1e-8); expect(Math.abs(p.up.dot(surface.faces[p.face].normal))).toBeLessThan(1e-6); });
  });
});

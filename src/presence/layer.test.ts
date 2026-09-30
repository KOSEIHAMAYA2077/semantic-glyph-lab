import { describe, expect, it } from 'vitest';
import { BoxGeometry, BufferGeometry, InstancedMesh, Matrix4, ShaderMaterial, SphereGeometry, Texture, Triangle, Vector3 } from 'three';
import type { LetterField } from '../letters';
import { Surface } from '../advection/surface';
import { PresenceLayer } from './layer';

function letters(count = 8) {
  return { grid: 8, revision: 0, texture: new Texture(), letters: Array.from({ length: count }, (_, i) => ({ text: String(i), ink: '#ffffff', at: 0, auto: false })) } as LetterField;
}
const glyphMesh = (layer: PresenceLayer) => layer.group.children.find(child => child instanceof InstancedMesh) as InstancedMesh;
const centers = (layer: PresenceLayer) => {
  const mesh = glyphMesh(layer), matrix = new Matrix4();
  return Array.from({ length: mesh.count }, (_, i) => { mesh.getMatrixAt(i, matrix); return new Vector3().setFromMatrixPosition(matrix); });
};
function cleanup(layer: PresenceLayer, geometry: BufferGeometry, field: LetterField) { layer.dispose(); geometry.dispose(); field.texture.dispose(); }
function nearestPercentile(points: Vector3[], q: number) {
  const distances = points.map((p, i) => {
    let min = Infinity;
    points.forEach((other, j) => { if (i !== j) min = Math.min(min, p.distanceTo(other)); });
    return min;
  }).sort((a, b) => a - b);
  return distances[Math.floor(q * (distances.length - 1))];
}

describe('continuous rigid surface glyphs', () => {
  it('keeps original character identities and positions when new colored input is added', () => {
    const geometry = new SphereGeometry(1, 16, 12), field = letters(8), layer = new PresenceLayer(geometry, field, 64);
    const mesh = glyphMesh(layer), before = centers(layer);
    const indices = mesh.geometry.getAttribute('glyphIndex');
    const original = Array.from({ length: 8 }, (_, index) => Array.from({ length: mesh.count }, (_, i) => i).find(i => indices.getX(i) === index)!);
    field.letters.push(...Array.from({ length: 9 }, (_, i) => ({ text: `新${i}`, ink: '#ff0000', at: 2, auto: false })));
    field.grid = 16; field.revision++;
    const originalTexture = field.texture, newTexture = new Texture() as LetterField['texture']; field.texture = newTexture;
    layer.update(0, 2);
    original.forEach((slot, index) => expect(indices.getX(slot)).toBe(index));
    expect(new Set(Array.from(indices.array))).toEqual(new Set(Array.from({ length: 17 }, (_, i) => i)));
    expect(centers(layer)).toEqual(before);
    expect(layer.inspect().distanceTraveled).toBe(0);
    expect((mesh.material as ShaderMaterial).uniforms.atlas.value).toBe(newTexture);
    expect((mesh.material as ShaderMaterial).uniforms.grid.value).toBe(16);
    const birth = mesh.geometry.getAttribute('glyphChangedAt');
    expect(Array.from(birth.array).filter(time => time === 2).length).toBeGreaterThan(0);
    for (const slot of original) expect(birth.getX(slot)).toBe(-100);
    cleanup(layer, geometry, field); originalTexture.dispose();
  });

  it('represents the newest window only when unique text exceeds the fixed glyph budget', () => {
    const geometry = new BoxGeometry(), field = letters(1), layer = new PresenceLayer(geometry, field, 12);
    field.letters = letters(81).letters; field.revision++;
    const before = centers(layer); layer.update(0, 1);
    expect(new Set(Array.from(glyphMesh(layer).geometry.getAttribute('glyphIndex').array))).toEqual(new Set(Array.from({ length: 12 }, (_, i) => 69 + i)));
    expect(centers(layer)).toEqual(before);
    cleanup(layer, geometry, field);
  });

  it('finishes new-input fades at zero flow speed and pauses them with scene time', () => {
    const geometry = new SphereGeometry(1, 12, 8), field = letters(1), layer = new PresenceLayer(geometry, field, 64);
    const before = centers(layer);
    layer.setBodyMotion(10, 0);
    field.letters.push({ text: '新', ink: '#ff0000', at: 10, auto: false }); field.revision++;
    layer.update(0, 0);
    const pending = layer.inspect().activePendingReassign;
    expect(pending).toBeGreaterThan(0);
    for (let frame = 0; frame < 60; frame++) { layer.setBodyMotion(10, 0); layer.update(0, 0); }
    expect(layer.inspect().activePendingReassign).toBe(pending);
    layer.setBodyMotion(10.8, 0); layer.update(0, 0);
    expect(layer.inspect().activePendingReassign).toBe(0);
    expect((glyphMesh(layer).material as ShaderMaterial).uniforms.glyphTime.value).toBe(10.8);
    expect(centers(layer)).toEqual(before); expect(layer.inspect().distanceTraveled).toBe(0);
    cleanup(layer, geometry, field);
  });

  it('uses area per glyph for equal density on differently scaled bodies', () => {
    const geometries = [new BoxGeometry(1, 1, 1), new BoxGeometry(3, 3, 3), new BoxGeometry(1, 1, 1)];
    const fields = geometries.map(() => letters());
    const layers = geometries.map((g, i) => new PresenceLayer(g, fields[i], i === 2 ? 256 : 64));
    expect(layers[1].inspect().glyphSize / layers[0].inspect().glyphSize).toBeCloseTo(3, 12);
    expect(layers[2].inspect().glyphSize / layers[0].inspect().glyphSize).toBeCloseTo(.5, 12);
    layers.forEach((layer, i) => cleanup(layer, geometries[i], fields[i]));
  });

  it('reduces crowded initialization without a later position correction or reseed', () => {
    const geometry = new SphereGeometry(1, 20, 12), field = letters(), count = 384;
    const layer = new PresenceLayer(geometry, field, count), surface = new Surface(geometry);
    const spaced = centers(layer), random = surface.seed(count).map(p => p.position);
    expect(nearestPercentile(spaced, .1)).toBeGreaterThan(nearestPercentile(random, .1) * 1.5);
    expect(spaced.every(point => surface.distance(point) < 1e-6)).toBe(true);
    const same = new PresenceLayer(geometry, field, count);
    expect(centers(same)).toEqual(spaced);
    same.dispose(); cleanup(layer, geometry, field);
  });

  it('walks continuously for five simulated minutes while keeping every glyph basis rigid', () => {
    const geometry = new SphereGeometry(1, 20, 12), field = letters(), layer = new PresenceLayer(geometry, field, 96);
    const mesh = glyphMesh(layer), matrix = new Matrix4(), initial = centers(layer);
    const size = layer.inspect().glyphSize, last = initial.map(p => p.clone());
    let maxStep = 0;
    for (let frame = 1; frame <= 9000; frame++) {
      layer.update(1 / 30, frame / 30);
      if (frame % 300 === 0) {
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, matrix);
          const x = new Vector3().setFromMatrixColumn(matrix, 0), y = new Vector3().setFromMatrixColumn(matrix, 1), z = new Vector3().setFromMatrixColumn(matrix, 2);
          expect(x.length()).toBeCloseTo(size, 6); expect(y.length()).toBeCloseTo(size, 6); expect(z.length()).toBeCloseTo(size, 6);
          expect(x.dot(y)).toBeCloseTo(0, 6); expect(x.dot(z)).toBeCloseTo(0, 6); expect(y.dot(z)).toBeCloseTo(0, 6);
          const p = new Vector3().setFromMatrixPosition(matrix);
          const points = ['triangleA', 'triangleB', 'triangleC'].map(name => new Vector3().fromBufferAttribute(mesh.geometry.getAttribute(name), i));
          expect(new Triangle(...points as [Vector3, Vector3, Vector3]).closestPointToPoint(p, new Vector3()).distanceTo(p)).toBeLessThan(1e-6);
        }
      }
      // Every frame for the first walkers, not only periodic end points.
      const samples = layer.inspect().sample;
      for (let i = 0; i < samples.length; i++) {
        const p = new Vector3().fromArray(samples[i].position);
        maxStep = Math.max(maxStep, p.distanceTo(last[i])); last[i].copy(p);
      }
    }
    expect(maxStep).toBeLessThan(.025);
    expect(layer.inspect().crossings).toBeGreaterThan(1000);
    expect(layer.inspect().distanceTraveled).toBeGreaterThan(100);
    expect(layer.inspect().boundaryStops).toBe(0);
    expect(layer.inspect().iterationStops).toBe(0);
    expect(centers(layer)).not.toEqual(initial);
    expect(layer.inspect().glyphSize).toBe(size);
    cleanup(layer, geometry, field);
  }, 20000);

  it('disposes only owned rendering resources and is safe to dispose twice', () => {
    const geometry = new SphereGeometry(1, 12, 8), field = letters(), layer = new PresenceLayer(geometry, field, 16);
    const mesh = glyphMesh(layer);
    let bodyDisposed = 0, atlasDisposed = 0, glyphDisposed = 0, materialDisposed = 0;
    geometry.addEventListener('dispose', () => bodyDisposed++); field.texture.addEventListener('dispose', () => atlasDisposed++);
    mesh.geometry.addEventListener('dispose', () => glyphDisposed++); (mesh.material as ShaderMaterial).addEventListener('dispose', () => materialDisposed++);
    layer.dispose(); layer.dispose(); layer.update(1 / 60, 1); layer.setBodyMotion(1, 1);
    expect(layer.group.children).toHaveLength(0);
    expect([bodyDisposed, atlasDisposed, glyphDisposed, materialDisposed]).toEqual([0, 0, 1, 1]);
    expect(layer.inspect().disposed).toBe(true);
    geometry.dispose(); field.texture.dispose();
  });

  it('ignores invalid timing and clamps a resumed-tab step without resetting walkers', () => {
    const geometry = new SphereGeometry(1, 12, 8), field = letters();
    const layer = new PresenceLayer(geometry, field, 32), reference = new PresenceLayer(geometry, field, 32);
    const before = centers(layer);
    layer.update(NaN, 1); layer.update(1, NaN); layer.update(-1, 2, NaN);
    expect(centers(layer)).toEqual(before);
    layer.update(5, 3); reference.update(.035, 3);
    expect(centers(layer)).toEqual(centers(reference));
    layer.setBodyMotion(NaN, Infinity);
    const material = glyphMesh(layer).material as ShaderMaterial;
    expect(material.uniforms.bodyTime.value).toBe(0); expect(material.uniforms.bodyMotion.value).toBe(0);
    reference.dispose(); cleanup(layer, geometry, field);
  });
});

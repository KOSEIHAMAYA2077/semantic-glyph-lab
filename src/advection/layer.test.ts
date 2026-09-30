import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Box3, BufferAttribute, BufferGeometry, InstancedMesh, Matrix3, Matrix4, Mesh, ShaderMaterial, SphereGeometry, Texture, Triangle, Vector3 } from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { LetterField } from '../letters';
import { AdvectionLayer } from './layer';

function lowPoly(name: string) {
  const object = new OBJLoader().parse(readFileSync(new URL(`../../public/models/kenney/${name}.obj`, import.meta.url), 'utf8'));
  object.updateMatrixWorld(true);
  const parts: BufferGeometry[] = [];
  object.traverse(child => { if (child instanceof Mesh) parts.push(child.geometry.clone().applyMatrix4(child.matrixWorld)); });
  const geometry = mergeGeometries(parts, false)!;
  const bounds = new Box3().setFromObject(object), center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3()), scale = 2.6 / Math.max(size.x, size.y, size.z);
  geometry.translate(-center.x, -center.y, -center.z).scale(scale, scale, scale);
  parts.forEach(part => part.dispose());
  object.traverse(child => { if (child instanceof Mesh) child.geometry.dispose(); });
  return geometry;
}

// Independent double-precision reference for the piecewise-affine contract.
// GPU shader execution is checked separately in the browser integration test.
function faceMap(p: Vector3, a: Vector3, b: Vector3, c: Vector3, warp: (p: Vector3) => Vector3) {
  const e1 = b.clone().sub(a), e2 = c.clone().sub(a), n = e1.clone().cross(e2).normalize();
  const basis = new Matrix3().set(e1.x, e2.x, n.x, e1.y, e2.y, n.y, e1.z, e2.z, n.z);
  const uvh = p.clone().sub(a).applyMatrix3(basis.invert());
  const wa = warp(a), wb = warp(b), wc = warp(c), we1 = wb.clone().sub(wa), we2 = wc.clone().sub(wa);
  return wa.addScaledVector(we1, uvh.x).addScaledVector(we2, uvh.y).addScaledVector(we1.clone().cross(we2).normalize(), uvh.z);
}
function currentWarp(p: Vector3, t: number) {
  return new Vector3(p.x + .10*Math.sin(p.y*1.3+t*.31) + .045*Math.sin(p.z*2-t*.17),
    p.y + .055*Math.sin(p.x*1.2+p.z*1.7+t*.23), p.z + .09*Math.sin(p.y*1.5-p.x*.9-t*.19));
}

describe('advection adapter resource and input ownership', () => {
  it('follows atlas changes and new graphemes without disposing caller resources', () => {
    const geometry = new SphereGeometry(1, 12, 8), texture = new Texture();
    const field = { grid: 8, revision: 0, texture, letters: [{ text: '@' }] } as LetterField;
    let geometryDisposals = 0, textureDisposals = 0;
    geometry.addEventListener('dispose', () => geometryDisposals++); texture.addEventListener('dispose', () => textureDisposals++);
    const layer = new AdvectionLayer(geometry, field, 12);
    const mesh = layer.group.children.find(child => child instanceof InstancedMesh) as InstancedMesh;
    const material = mesh.material as ShaderMaterial;
    expect(mesh.geometry.getAttribute('glyphIndex').getX(11)).toBe(0);
    field.letters = Array.from({ length: 81 }, (_, i) => ({ text: String(i), ink: '#fff', at: 0, auto: false })); field.grid = 16; field.revision++;
    layer.update(1/60, 1, .08);
    expect(material.uniforms.grid.value).toBe(16);
    expect(mesh.geometry.getAttribute('glyphIndex').getX(0)).toBe(69);
    expect(mesh.geometry.getAttribute('glyphIndex').getX(11)).toBe(80);
    expect(Array.from(mesh.instanceMatrix.array).every(Number.isFinite)).toBe(true);
    layer.dispose(); layer.dispose();
    expect(layer.group.children).toHaveLength(0); expect(geometryDisposals).toBe(0); expect(textureDisposals).toBe(0);
  });

  it.each(['flower_purpleA', 'mushroom_red', 'tree_oak'])('keeps centers on the warped low-poly %s faces', name => {
    const geometry = lowPoly(name), field = { grid: 8, revision: 0, texture: new Texture(), letters: [{ text: '@' }] } as LetterField;
    const layer = new AdvectionLayer(geometry, field, 256);
    const mesh = layer.group.children.find(child => child instanceof InstancedMesh) as InstancedMesh;
    const matrix = new Matrix4(), a = new Vector3(), b = new Vector3(), c = new Vector3();
    let oldBuried = 0, maxReferenceError = 0;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix); const center = new Vector3().setFromMatrixPosition(matrix);
      a.fromBufferAttribute(mesh.geometry.getAttribute('triangleA'), i);
      b.fromBufferAttribute(mesh.geometry.getAttribute('triangleB'), i);
      c.fromBufferAttribute(mesh.geometry.getAttribute('triangleC'), i);
      // The attributes describe the actual source face containing this walker.
      expect(new Triangle(a, b, c).closestPointToPoint(center, new Vector3()).distanceTo(center)).toBeCloseTo(.002, 5);
      for (const time of [0, 5, 10, 20, 30]) {
        const warp = (p: Vector3) => currentWarp(p, time);
        const wa = warp(a), wb = warp(b), wc = warp(c);
        const normal = wb.clone().sub(wa).cross(wc.clone().sub(wa)).normalize();
        const signed = faceMap(center, a, b, c, warp).sub(wa).dot(normal);
        maxReferenceError = Math.max(maxReferenceError, Math.abs(signed - .002));
        if (warp(center).sub(wa).dot(normal) < 0) oldBuried++;
      }
    }
    expect(oldBuried).toBeGreaterThan(0); // Demonstrates the original regression on this real asset.
    expect(maxReferenceError).toBeLessThan(1e-6);
    layer.dispose(); geometry.dispose(); field.texture.dispose();
  });

  it('refreshes crossed triangles and shares their attributes/uniforms with scene copies', () => {
    const geometry = lowPoly('mushroom_red'), field = { grid: 8, revision: 0, texture: new Texture(), letters: [{ text: '@' }] } as LetterField;
    const layer = new AdvectionLayer(geometry, field, 128), copy = layer.group.clone();
    const mesh = layer.group.children.find(child => child instanceof InstancedMesh) as InstancedMesh;
    const duplicate = copy.children.find(child => child instanceof InstancedMesh) as InstancedMesh;
    duplicate.instanceMatrix = mesh.instanceMatrix; // The existing SurfaceScene copy contract.
    const attribute = mesh.geometry.getAttribute('triangleA') as BufferAttribute;
    const version = attribute.version, before = Array.from(attribute.array);
    for (let i = 0; i < 180; i++) layer.update(1/60, i/60, .08);
    layer.setBodyMotion(3, 1);
    expect(attribute.version).toBeGreaterThan(version);
    expect(Array.from(attribute.array)).not.toEqual(before);
    expect(duplicate.geometry).toBe(mesh.geometry);
    expect(duplicate.geometry.getAttribute('triangleA')).toBe(attribute);
    expect(duplicate.instanceMatrix).toBe(mesh.instanceMatrix);
    expect(duplicate.material).toBe(mesh.material);
    expect((duplicate.material as ShaderMaterial).uniforms.bodyTime.value).toBe(3);
    expect((duplicate.material as ShaderMaterial).uniforms.bodyMotion.value).toBe(1);
    // After crossings, all instance centers still belong to their newly encoded faces.
    const matrix = new Matrix4();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix); const center = new Vector3().setFromMatrixPosition(matrix);
      const points = ['triangleA', 'triangleB', 'triangleC'].map(name => new Vector3().fromBufferAttribute(mesh.geometry.getAttribute(name), i));
      expect(new Triangle(...points as [Vector3, Vector3, Vector3]).closestPointToPoint(center, new Vector3()).distanceTo(center)).toBeCloseTo(.002, 5);
    }
    duplicate.dispose(); layer.dispose(); geometry.dispose(); field.texture.dispose();
  });
});

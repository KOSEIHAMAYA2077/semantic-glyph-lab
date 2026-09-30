import { describe, expect, it } from 'vitest';
import { InstancedMesh, ShaderMaterial, SphereGeometry, Texture } from 'three';
import type { LetterField } from '../letters';
import { AdvectionLayer } from './layer';

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
});

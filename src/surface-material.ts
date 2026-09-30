import * as THREE from 'three';
import type { LetterField } from './letters';
export function createSurfaceMaterial(field: LetterField) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide, depthWrite: true,
    uniforms: {
      glyphs: { value: field.texture }, time: { value: 0 }, grid: { value: field.grid }, density: { value: 15 },
      flow: { value: 1 }, brightness: { value: 1 }, reveal: { value: 1 },
    },
    vertexShader: `
      varying vec3 p; varying vec3 n; varying vec3 viewN;
      void main() { p = position; n = normal; viewN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }
    `,
    fragmentShader: `
      uniform sampler2D glyphs;
      uniform float time, grid, density, flow, brightness, reveal;
      varying vec3 p; varying vec3 n; varying vec3 viewN;
      vec3 pattern(vec2 v) {
        return texture2D(glyphs, v * density / grid).rgb;
      }
      void main() {
        float t = time * .085;
        // Smooth coordinate advection: nearby points move together. No framewise jitter.
        vec3 q = p;
        q.x += flow * (.16 * sin(p.y * 2.6 + p.z * 1.7 + t * .73) + .08 * sin(p.z * 4.2 - t * .31));
        q.y += flow * (.20 * sin(p.z * 2.1 - p.x * 1.4 + t * .49) + .06 * sin(p.x * 5. - t * .27));
        q.z += flow * (.17 * sin(p.x * 2.3 + p.y * 1.9 - t * .61));
        q += flow * vec3(t * .16, -t * .23, t * .13);
        vec3 weights = pow(abs(normalize(n)), vec3(8.));
        weights /= max(.0001, weights.x + weights.y + weights.z);
        vec3 a = pattern(q.zy * vec2(sign(n.x), 1.));
        vec3 b = pattern(q.xz * vec2(1., sign(n.y)));
        vec3 c = pattern(q.xy * vec2(sign(n.z), 1.));
        vec3 ink = a * weights.x + b * weights.y + c * weights.z;
        float light = .36 + .64 * pow(abs(normalize(viewN).z), .55);
        // Black fragments still write depth, so back-side letters cannot show through.
        gl_FragColor = vec4(ink * light * brightness * reveal, 1.);
      }
    `,
  });
}

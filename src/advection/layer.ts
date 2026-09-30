import * as THREE from 'three';
import type { LetterField } from '../letters';
import { Surface, type Particle } from './surface';
import { StreamField } from './stream';

/** Optional static-mesh comparison. Geometry and LetterField remain caller-owned. */
export class AdvectionLayer {
  readonly group = new THREE.Group();
  private readonly surface: Surface;
  private readonly stream: StreamField;
  private readonly particles: Particle[];
  private readonly glyphGeometry = new THREE.PlaneGeometry(1, 1);
  private readonly glyphMaterial: THREE.ShaderMaterial;
  private readonly bodyMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
  private readonly glyphs: THREE.InstancedMesh;
  private readonly indices: THREE.InstancedBufferAttribute;
  private revision = -1;
  private disposed = false;
  private readonly dummy = new THREE.Object3D();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();
  constructor(geometry: THREE.BufferGeometry, private readonly field: LetterField, count = 2000) {
    if (!Number.isSafeInteger(count) || count < 1 || count > 100_000) throw new Error('Glyph count must be an integer from 1 to 100000');
    this.surface = new Surface(geometry); this.stream = new StreamField(this.surface); this.particles = this.surface.seed(count);
    this.indices = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    this.indices.setUsage(THREE.DynamicDrawUsage); this.glyphGeometry.setAttribute('glyphIndex', this.indices);
    this.glyphMaterial = new THREE.ShaderMaterial({
      uniforms: { atlas: { value: field.texture }, grid: { value: field.grid } }, side: THREE.FrontSide,
      vertexShader: `attribute float glyphIndex; uniform float grid; varying vec2 glyphUv;
        void main(){glyphUv=vec2(mod(glyphIndex,grid)+uv.x,grid-1.0-floor(glyphIndex/grid)+uv.y)/grid;
        gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}`,
      fragmentShader: `uniform sampler2D atlas; varying vec2 glyphUv;
        void main(){vec3 ink=texture2D(atlas,glyphUv).rgb;if(max(ink.r,max(ink.g,ink.b))<.14)discard;gl_FragColor=vec4(ink,1.0);}`,
    });
    this.glyphs = new THREE.InstancedMesh(this.glyphGeometry, this.glyphMaterial, count);
    this.glyphs.frustumCulled = false; this.glyphs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const body = new THREE.Mesh(geometry, this.bodyMaterial); body.renderOrder = -1;
    this.group.add(body, this.glyphs); this.update(0, 0, .09);
  }
  update(dt: number, time: number, glyphSize: number) {
    if (this.disposed) return;
    this.glyphMaterial.uniforms.atlas.value = this.field.texture;
    this.glyphMaterial.uniforms.grid.value = this.field.grid;
    if (this.revision !== this.field.revision) {
      this.revision = this.field.revision;
      const length = Math.max(1, this.field.letters.length);
      // Cycle graphemes, including their atlas colors. When input exceeds the
      // particle budget, retain the newest budget-size window, not a stale prefix.
      const start = Math.max(0, length - this.particles.length);
      for (let i = 0; i < this.particles.length; i++) this.indices.setX(i, (start + i) % length);
      this.indices.needsUpdate = true;
    }
    if (dt > 0 && Number.isFinite(dt) && Number.isFinite(time)) this.stream.step(this.particles, Math.min(dt, .035), time);
    const size = Number.isFinite(glyphSize) && glyphSize > 0 ? glyphSize : .09;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i], normal = this.surface.faces[p.face].normal;
      this.up.copy(p.up).addScaledVector(normal, -p.up.dot(normal)).normalize();
      this.right.crossVectors(this.up, normal).normalize(); this.basis.makeBasis(this.right, this.up, normal);
      this.dummy.position.copy(p.position).addScaledVector(normal, .002);
      this.dummy.quaternion.setFromRotationMatrix(this.basis); this.dummy.scale.setScalar(size); this.dummy.updateMatrix();
      this.glyphs.setMatrixAt(i, this.dummy.matrix);
    }
    this.glyphs.instanceMatrix.needsUpdate = true;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.glyphs.dispose(); this.glyphGeometry.dispose(); this.glyphMaterial.dispose(); this.bodyMaterial.dispose();
    this.group.clear();
    // Do not dispose the borrowed body geometry, atlas texture, or LetterField.
  }
}

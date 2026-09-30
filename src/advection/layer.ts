import * as THREE from 'three';
import type { LetterField } from '../letters';
import { Surface, type Particle } from './surface';
import { StreamField } from './stream';
import { BODY_MOTION_GLSL } from '../body-motion';

/** Walk rest-space triangles; render letters on the same warped triangles as the body. */
export class AdvectionLayer {
  readonly group = new THREE.Group();
  private readonly surface: Surface;
  private readonly stream: StreamField;
  private readonly particles: Particle[];
  private readonly glyphGeometry = new THREE.PlaneGeometry(1, 1);
  private readonly glyphMaterial: THREE.ShaderMaterial;
  private readonly bodyMaterial = new THREE.ShaderMaterial({
    uniforms:{bodyTime:{value:0},bodyMotion:{value:0}},side:THREE.DoubleSide,
    vertexShader:`${BODY_MOTION_GLSL} void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(bodyWarp(position),1.);}`,
    fragmentShader:'void main(){gl_FragColor=vec4(0.,0.,0.,1.);}'
  });
  private readonly glyphs: THREE.InstancedMesh;
  private readonly indices: THREE.InstancedBufferAttribute;
  private readonly triangleA: THREE.InstancedBufferAttribute;
  private readonly triangleB: THREE.InstancedBufferAttribute;
  private readonly triangleC: THREE.InstancedBufferAttribute;
  private readonly triangleFaces: Int32Array;
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
    this.triangleA = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.triangleB = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.triangleC = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    for (const [name, attribute] of [['triangleA', this.triangleA], ['triangleB', this.triangleB], ['triangleC', this.triangleC]] as const) {
      attribute.setUsage(THREE.DynamicDrawUsage); this.glyphGeometry.setAttribute(name, attribute);
    }
    this.triangleFaces = new Int32Array(count).fill(-1);
    this.glyphMaterial = new THREE.ShaderMaterial({
      uniforms: { atlas: { value: field.texture }, grid: { value: field.grid },bodyTime:{value:0},bodyMotion:{value:0} }, side: THREE.FrontSide,
      vertexShader: `${BODY_MOTION_GLSL} attribute float glyphIndex; uniform float grid; varying vec2 glyphUv;
        attribute vec3 triangleA, triangleB, triangleC;
        vec3 glyphOnWarpedFace(vec3 p) {
          if(bodyMotion==0.) return p;
          vec3 e1=triangleB-triangleA, e2=triangleC-triangleA, d=p-triangleA;
          vec3 areaNormal=cross(e1,e2);
          float areaSquared=max(dot(areaNormal,areaNormal),1.e-30);
          // Cross products avoid the Gram determinant's cancellation on thin faces.
          float u=dot(cross(d,e2),areaNormal)/areaSquared;
          float v=dot(cross(e1,d),areaNormal)/areaSquared;
          float height=dot(d,areaNormal)*inversesqrt(areaSquared);
          vec3 a=bodyWarp(triangleA), b=bodyWarp(triangleB), c=bodyWarp(triangleC);
          vec3 warpedNormal=normalize(cross(b-a,c-a));
          return a+u*(b-a)+v*(c-a)+height*warpedNormal;
        }
        void main(){glyphUv=vec2(mod(glyphIndex,grid)+uv.x,grid-1.0-floor(glyphIndex/grid)+uv.y)/grid;
        vec3 base=(instanceMatrix*vec4(position,1.0)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(glyphOnWarpedFace(base),1.0);}`,
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
    let trianglesChanged = false;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i], face = this.surface.faces[p.face], normal = face.normal;
      if (this.triangleFaces[i] !== p.face) {
        this.triangleFaces[i] = p.face; trianglesChanged = true;
        this.triangleA.setXYZ(i, face.a.x, face.a.y, face.a.z);
        this.triangleB.setXYZ(i, face.a.x + face.e1.x, face.a.y + face.e1.y, face.a.z + face.e1.z);
        this.triangleC.setXYZ(i, face.a.x + face.e2.x, face.a.y + face.e2.y, face.a.z + face.e2.z);
      }
      this.up.copy(p.up).addScaledVector(normal, -p.up.dot(normal)).normalize();
      this.right.crossVectors(this.up, normal).normalize(); this.basis.makeBasis(this.right, this.up, normal);
      this.dummy.position.copy(p.position).addScaledVector(normal, .002);
      this.dummy.quaternion.setFromRotationMatrix(this.basis); this.dummy.scale.setScalar(size); this.dummy.updateMatrix();
      this.glyphs.setMatrixAt(i, this.dummy.matrix);
    }
    if (trianglesChanged) this.triangleA.needsUpdate = this.triangleB.needsUpdate = this.triangleC.needsUpdate = true;
    this.glyphs.instanceMatrix.needsUpdate = true;
  }
  setBodyMotion(time:number,amount:number){
    this.bodyMaterial.uniforms.bodyTime.value=this.glyphMaterial.uniforms.bodyTime.value=time;
    this.bodyMaterial.uniforms.bodyMotion.value=this.glyphMaterial.uniforms.bodyMotion.value=amount;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.glyphs.dispose(); this.glyphGeometry.dispose(); this.glyphMaterial.dispose(); this.bodyMaterial.dispose();
    this.group.clear();
    // Do not dispose the borrowed body geometry, atlas texture, or LetterField.
  }
}

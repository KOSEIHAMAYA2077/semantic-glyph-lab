import * as THREE from 'three';
import type { LetterField } from '../letters';
import { Surface, type Particle } from '../advection/surface';
import { StreamField } from '../advection/stream';
import { BODY_MOTION_GLSL } from '../body-motion';

/** A fixed count of continuously walking, rigid glyphs. The input geometry and atlas are borrowed. */
export class PresenceLayer {
  readonly group = new THREE.Group();
  private readonly surface: Surface;
  private readonly stream: StreamField;
  private readonly particles: Particle[];
  private readonly glyphGeometry = new THREE.PlaneGeometry(1, 1);
  private readonly glyphMaterial: THREE.ShaderMaterial;
  private readonly bodyMaterial = new THREE.ShaderMaterial({
    uniforms: { bodyTime: { value: 0 }, bodyMotion: { value: 0 } }, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    vertexShader: `${BODY_MOTION_GLSL} void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(bodyWarp(position),1.);}`,
    fragmentShader: 'void main(){gl_FragColor=vec4(0.,0.,0.,1.);}',
  });
  private readonly glyphs: THREE.InstancedMesh;
  private readonly indices: THREE.InstancedBufferAttribute;
  private readonly previousIndices: THREE.InstancedBufferAttribute;
  private readonly changedAt: THREE.InstancedBufferAttribute;
  private readonly barycentric: THREE.InstancedBufferAttribute;
  private readonly triangleA: THREE.InstancedBufferAttribute;
  private readonly triangleB: THREE.InstancedBufferAttribute;
  private readonly triangleC: THREE.InstancedBufferAttribute;
  private readonly triangleFaces: Int32Array;
  private readonly baseGlyphSize: number;
  private glyphSize: number;
  private revision = -1;
  private letterCount = 0;
  private disposed = false;
  private time = 0;
  private animationTime: number | undefined;
  private readonly dummy = new THREE.Object3D();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();

  constructor(geometry: THREE.BufferGeometry, private readonly field: LetterField, count = 3072) {
    if (!Number.isSafeInteger(count) || count < 1 || count > 100_000) throw new Error('Glyph count must be an integer from 1 to 100000');
    this.surface = new Surface(geometry);
    this.stream = new StreamField(this.surface);
    this.particles = seedSpaced(this.surface, count);
    // The atlas has margins: a 1.28-pitch plane gives about one pitch of actual ink.
    this.baseGlyphSize = Math.sqrt(this.surface.totalArea / count) * 1.28;
    this.glyphSize = this.baseGlyphSize;
    const attribute = (name: string, width: number) => {
      const value = new THREE.InstancedBufferAttribute(new Float32Array(count * width), width);
      value.setUsage(THREE.DynamicDrawUsage); this.glyphGeometry.setAttribute(name, value); return value;
    };
    this.indices = attribute('glyphIndex', 1);
    this.previousIndices = attribute('previousGlyphIndex', 1);
    this.changedAt = attribute('glyphChangedAt', 1);
    this.barycentric = attribute('surfaceBary', 2);
    this.triangleA = attribute('triangleA', 3);
    this.triangleB = attribute('triangleB', 3);
    this.triangleC = attribute('triangleC', 3);
    this.triangleFaces = new Int32Array(count).fill(-1);
    this.glyphMaterial = new THREE.ShaderMaterial({
      uniforms: {
        atlas: { value: field.texture }, grid: { value: field.grid },
        bodyTime: { value: 0 }, bodyMotion: { value: 0 }, glyphTime: { value: 0 },
      },
      side: THREE.FrontSide,
      vertexShader: `${BODY_MOTION_GLSL}
        attribute float glyphIndex, previousGlyphIndex, glyphChangedAt;
        attribute vec2 surfaceBary;
        attribute vec3 triangleA, triangleB, triangleC;
        uniform float grid, glyphTime;
        varying vec2 glyphUv;
        varying vec3 glyphViewNormal, glyphViewDirection;
        varying float glyphFade;
        void main(){
          // Fade a replaced duplicate out before introducing a new character.
          // The walker itself never restarts or switches position.
          float progress=clamp((glyphTime-glyphChangedAt)/.7,0.,1.);
          float index=progress<.5?previousGlyphIndex:glyphIndex;
          glyphFade=abs(progress*2.-1.);
          glyphUv=vec2(mod(index,grid)+uv.x,grid-1.-floor(index/grid)+uv.y)/grid;
          vec3 a=bodyWarp(triangleA), b=bodyWarp(triangleB), c=bodyWarp(triangleC);
          vec3 e1=triangleB-triangleA, e2=triangleC-triangleA;
          vec3 we1=b-a, we2=c-a, normal=normalize(cross(we1,we2));
          vec3 center=a+surfaceBary.x*we1+surfaceBary.y*we2;
          vec3 restRight=normalize(instanceMatrix[0].xyz), areaNormal=cross(e1,e2);
          float areaSquared=max(dot(areaNormal,areaNormal),1.e-30);
          float u=dot(cross(restRight,e2),areaNormal)/areaSquared;
          float v=dot(cross(e1,restRight),areaNormal)/areaSquared;
          // Gram-Schmidt removes the body's local stretch and shear from glyphs.
          vec3 right=normalize(u*we1+v*we2), up=normalize(cross(normal,right));
          right=normalize(cross(up,normal));
          float size=length(instanceMatrix[0].xyz);
          vec3 p=center+normal*size*.07+size*(position.x*right+position.y*up);
          vec4 viewPosition=modelViewMatrix*vec4(p,1.);
          glyphViewNormal=normalize(normalMatrix*normal);
          glyphViewDirection=-viewPosition.xyz;
          gl_Position=projectionMatrix*viewPosition;
        }`,
      fragmentShader: `uniform sampler2D atlas; varying vec2 glyphUv;
        varying vec3 glyphViewNormal, glyphViewDirection; varying float glyphFade;
        void main(){
          vec3 ink=texture2D(atlas,glyphUv).rgb;
          if(max(ink.r,max(ink.g,ink.b))<.08 || glyphFade<.01) discard;
          vec3 normal=normalize(glyphViewNormal);
          float facing=max(0.,dot(normal,normalize(glyphViewDirection)));
          float lamp=max(0.,dot(normal,normalize(vec3(-.35,.5,1.))));
          float light=(.19+.81*pow(facing,.65))*(.8+.2*lamp);
          gl_FragColor=vec4(ink*light*glyphFade,1.);
        }`,
    });
    this.glyphs = new THREE.InstancedMesh(this.glyphGeometry, this.glyphMaterial, count);
    this.glyphs.frustumCulled = false;
    this.glyphs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const body = new THREE.Mesh(geometry, this.bodyMaterial); body.renderOrder = -1;
    this.group.add(body, this.glyphs);
    this.update(0, 0);
  }

  update(dt: number, time: number, glyphSizeMultiplier = 1) {
    if (this.disposed) return;
    if (Number.isFinite(time)) this.time = time;
    this.glyphMaterial.uniforms.glyphTime.value = this.animationTime ?? this.time;
    this.glyphMaterial.uniforms.atlas.value = this.field.texture;
    this.glyphMaterial.uniforms.grid.value = this.field.grid;
    if (this.revision !== this.field.revision) this.refreshAssignments();
    if (dt > 0 && Number.isFinite(dt) && Number.isFinite(time)) this.stream.step(this.particles, Math.min(dt, .035), time);
    const multiplier = Number.isFinite(glyphSizeMultiplier) && glyphSizeMultiplier > 0 ? Math.min(4, glyphSizeMultiplier) : 1;
    this.glyphSize = this.baseGlyphSize * multiplier;
    let trianglesChanged = false;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i], face = this.surface.faces[p.face], normal = face.normal;
      if (this.triangleFaces[i] !== p.face) {
        this.triangleFaces[i] = p.face; trianglesChanged = true;
        this.triangleA.setXYZ(i, face.a.x, face.a.y, face.a.z);
        this.triangleB.setXYZ(i, face.a.x + face.e1.x, face.a.y + face.e1.y, face.a.z + face.e1.z);
        this.triangleC.setXYZ(i, face.a.x + face.e2.x, face.a.y + face.e2.y, face.a.z + face.e2.z);
      }
      this.barycentric.setXY(i, p.bary[1], p.bary[2]);
      this.up.copy(p.up).addScaledVector(normal, -p.up.dot(normal)).normalize();
      this.right.crossVectors(this.up, normal).normalize();
      this.basis.makeBasis(this.right, this.up, normal);
      this.dummy.position.copy(p.position);
      this.dummy.quaternion.setFromRotationMatrix(this.basis);
      this.dummy.scale.setScalar(this.glyphSize); this.dummy.updateMatrix();
      this.glyphs.setMatrixAt(i, this.dummy.matrix);
    }
    if (trianglesChanged) this.triangleA.needsUpdate = this.triangleB.needsUpdate = this.triangleC.needsUpdate = true;
    this.barycentric.needsUpdate = true;
    this.glyphs.instanceMatrix.needsUpdate = true;
  }

  private refreshAssignments() {
    const count = this.particles.length, length = Math.max(1, this.field.letters.length);
    const start = Math.max(0, length - count), kept = length - start;
    if (this.revision < 0 || length < this.letterCount) {
      for (let i = 0; i < count; i++) {
        const index = start + i % kept;
        this.indices.setX(i, index); this.previousIndices.setX(i, index); this.changedAt.setX(i, -100);
      }
    } else if (length !== this.letterCount) {
      // Keep every still-supported original character in place. Only its excess
      // copies are eligible to become new input; no particle position is changed.
      const targets = new Int32Array(length), used = new Int32Array(length), free: number[] = [];
      for (let i = start; i < length; i++) targets[i] = Math.floor(count / kept) + (i - start < count % kept ? 1 : 0);
      for (let i = 0; i < count; i++) {
        const index = this.indices.getX(i);
        if (index >= start && index < length && used[index] < targets[index]) used[index]++;
        else free.push(i);
      }
      // A fixed permutation spreads new ink across the object instead of a face-order stripe.
      free.sort((a, b) => hash(a) - hash(b));
      let slot = 0;
      for (let index = start; index < length; index++) for (let needed = targets[index] - used[index]; needed > 0; needed--) {
        const i = free[slot++];
        this.previousIndices.setX(i, this.indices.getX(i)); this.indices.setX(i, index); this.changedAt.setX(i, this.animationTime ?? this.time);
      }
    }
    this.revision = this.field.revision; this.letterCount = length;
    this.indices.needsUpdate = this.previousIndices.needsUpdate = this.changedAt.needsUpdate = true;
  }

  setBodyMotion(time: number, amount: number) {
    if (this.disposed) return;
    const t = Number.isFinite(time) ? time : 0;
    const strength = Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 0;
    // Scene time keeps input fades alive even when the flow speed is zero.
    // A paused scene supplies the same time and therefore pauses the fade too.
    this.animationTime = t; this.glyphMaterial.uniforms.glyphTime.value = t;
    this.bodyMaterial.uniforms.bodyTime.value = this.glyphMaterial.uniforms.bodyTime.value = t;
    this.bodyMaterial.uniforms.bodyMotion.value = this.glyphMaterial.uniforms.bodyMotion.value = strength;
  }

  inspect() {
    const samples = this.particles.slice(0, 12).map((p, i) => ({
      position: p.position.toArray(), face: p.face, crossings: p.crossings, glyphIndex: this.indices.getX(i),
    }));
    let activePendingReassign = 0;
    for (let i = 0; i < this.particles.length; i++) if ((this.animationTime ?? this.time) - this.changedAt.getX(i) < .7) activePendingReassign++;
    return {
      count: this.particles.length, area: this.surface.totalArea, glyphSize: this.glyphSize,
      letterCount: this.letterCount, uniqueCapacity: this.particles.length,
      time: this.time, animationTime: this.animationTime ?? this.time, disposed: this.disposed,
      distanceTraveled: this.stream.distanceTraveled, crossings: this.surface.crossings,
      boundaryStops: this.surface.boundaryStops, iterationStops: this.surface.iterationStops,
      boundaryEdges: this.surface.boundaryEdges, nonManifoldEdges: this.surface.nonManifoldEdges,
      activePendingReassign, samples, sample: samples,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.glyphs.dispose(); this.glyphGeometry.dispose(); this.glyphMaterial.dispose(); this.bodyMaterial.dispose();
    this.group.clear();
  }
}

function hash(value: number) {
  let x = (value + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ x >>> 16, 0x21f0aaad); x = Math.imul(x ^ x >>> 15, 0x735a2d97);
  return (x ^ x >>> 15) >>> 0;
}
const radicalInverse = (value: number, base: number) => {
  let sum = 0, place = 1 / base;
  while (value > 0) { sum += value % base * place; value = Math.floor(value / base); place /= base; }
  return sum;
};

/** Area-stratified candidates, then a local spacing choice; initialization only. */
function seedSpaced(surface: Surface, count: number): Particle[] {
  const result: Particle[] = [], cellSize = Math.sqrt(surface.totalArea / count);
  const buckets = new Map<string, THREE.Vector3[]>();
  const point = new THREE.Vector3(), chosen = new THREE.Vector3();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  for (let i = 0; i < count; i++) {
    const area = (i + .5) / count * surface.totalArea;
    let low = 0, high = surface.cdf.length - 1;
    while (low < high) { const mid = (low + high) >> 1; if (surface.cdf[mid] < area) low = mid + 1; else high = mid; }
    const face = surface.faces[low];
    let bestScore = -1, bestBary: [number, number, number] = [1, 0, 0];
    for (let candidate = 0; candidate < 8; candidate++) {
      const sequence = i * 8 + candidate + 1;
      const root = Math.sqrt(radicalInverse(sequence, 2)), second = radicalInverse(sequence, 3);
      const bary: [number, number, number] = [1 - root, root * (1 - second), root * second];
      point.copy(face.a).addScaledVector(face.e1, bary[1]).addScaledVector(face.e2, bary[2]);
      const x = Math.floor(point.x / cellSize), y = Math.floor(point.y / cellSize), z = Math.floor(point.z / cellSize);
      let nearestSq = cellSize * cellSize * 4;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        for (const previous of buckets.get(key(x + dx, y + dy, z + dz)) ?? []) nearestSq = Math.min(nearestSq, previous.distanceToSquared(point));
      }
      if (nearestSq > bestScore) { bestScore = nearestSq; bestBary = bary; chosen.copy(point); }
    }
    const up = new THREE.Vector3(0, 1, 0).addScaledVector(face.normal, -face.normal.y);
    if (up.lengthSq() < .01) up.set(0, 0, 1).addScaledVector(face.normal, -face.normal.z);
    const p: Particle = { face: low, bary: bestBary, position: chosen.clone(), up: up.normalize(), crossings: 0 };
    result.push(p);
    const bucketKey = key(Math.floor(chosen.x / cellSize), Math.floor(chosen.y / cellSize), Math.floor(chosen.z / cellSize));
    const bucket = buckets.get(bucketKey) ?? []; bucket.push(chosen.clone()); buckets.set(bucketKey, bucket);
  }
  return result;
}

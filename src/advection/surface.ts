import * as THREE from 'three';

export interface Face {
  a: THREE.Vector3; e1: THREE.Vector3; e2: THREE.Vector3; normal: THREE.Vector3;
  ids: [number, number, number]; neighbors: [number, number, number];
  area: number; d00: number; d01: number; d11: number; inverse: number;
  box: THREE.Box3; center: THREE.Vector3;
}
export interface Particle { face: number; bary: [number, number, number]; position: THREE.Vector3; up: THREE.Vector3; crossings: number }
interface Node { box: THREE.Box3; left?: Node; right?: Node; faces?: number[] }
const tmp = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
const displacement = new THREE.Vector3(), omega = new THREE.Vector3(), velocity = new THREE.Vector3();
const turn = new THREE.Quaternion(), triangle = new THREE.Triangle(), nearest = new THREE.Vector3();

export function randomSource(seed: number) {
  let state = seed >>> 0;
  return () => { state += 0x6D2B79F5; let z = state; z = Math.imul(z ^ z >>> 15, z | 1); z ^= z + Math.imul(z ^ z >>> 7, z | 61); return ((z ^ z >>> 14) >>> 0) / 4294967296; };
}

/** Static triangle graph. Particle state never switches to random respawning. */
export class Surface {
  faces: Face[] = [];
  cdf: number[] = [];
  totalArea = 0;
  boundaryEdges = 0;
  nonManifoldEdges = 0;
  degenerateFaces = 0;
  crossings = 0;
  boundaryStops = 0;
  iterationStops = 0;
  distanceTraveled = 0;
  private bvh: Node;
  constructor(geometry: THREE.BufferGeometry) {
    const pos = geometry.getAttribute('position'), index = geometry.index;
    const weld = new Map<string, number>();
    const welded = new Int32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const key = `${Math.round(pos.getX(i) * 1e6)},${Math.round(pos.getY(i) * 1e6)},${Math.round(pos.getZ(i) * 1e6)}`;
      if (!weld.has(key)) weld.set(key, weld.size);
      welded[i] = weld.get(key)!;
    }
    const count = index?.count ?? pos.count;
    for (let i = 0; i + 2 < count; i += 3) {
      const raw = [0, 1, 2].map(k => index ? index.getX(i + k) : i + k);
      const points = raw.map(j => new THREE.Vector3().fromBufferAttribute(pos, j));
      const [a, p1, p2] = points;
      const e1 = p1.clone().sub(a), e2 = p2.clone().sub(a), normal = e1.clone().cross(e2);
      const area = normal.length() * .5;
      if (area < 1e-12 || new Set(raw.map(j => welded[j])).size < 3) { this.degenerateFaces++; continue; }
      normal.normalize();
      const d00 = e1.dot(e1), d01 = e1.dot(e2), d11 = e2.dot(e2);
      this.faces.push({ a, e1, e2, normal, ids: raw.map(j => welded[j]) as [number, number, number], neighbors: [-1, -1, -1], area, d00, d01, d11, inverse: 1 / (d00 * d11 - d01 * d01), box: new THREE.Box3().setFromPoints(points), center: a.clone().add(p1).add(p2).multiplyScalar(1 / 3) });
      this.totalArea += area; this.cdf.push(this.totalArea);
    }
    if (!this.faces.length) throw new Error('No nondegenerate triangles');
    const edges = new Map<string, [number, number][]>();
    this.faces.forEach((face, fi) => face.ids.forEach((_, opposite) => {
      const a = face.ids[(opposite + 1) % 3], b = face.ids[(opposite + 2) % 3];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const entries = edges.get(key) ?? []; entries.push([fi, opposite]); edges.set(key, entries);
    }));
    for (const pair of edges.values()) {
      if (pair.length === 2) {
        this.faces[pair[0][0]].neighbors[pair[0][1]] = pair[1][0];
        this.faces[pair[1][0]].neighbors[pair[1][1]] = pair[0][0];
      } else if (pair.length === 1) this.boundaryEdges++;
      else this.nonManifoldEdges++;
    }
    this.bvh = this.buildNode(this.faces.map((_, i) => i));
  }
  private buildNode(ids: number[]): Node {
    const box = new THREE.Box3(); for (const id of ids) box.union(this.faces[id].box);
    if (ids.length <= 12) return { box, faces: ids };
    const extent = box.getSize(new THREE.Vector3());
    const axis: 'x' | 'y' | 'z' = extent.x >= extent.y && extent.x >= extent.z ? 'x' : extent.y >= extent.z ? 'y' : 'z';
    ids.sort((a, b) => this.faces[a].center[axis] - this.faces[b].center[axis]);
    const half = ids.length >> 1;
    return { box, left: this.buildNode(ids.slice(0, half)), right: this.buildNode(ids.slice(half)) };
  }
  position(p: Particle): THREE.Vector3 {
    const face = this.faces[p.face];
    return p.position.copy(face.a).addScaledVector(face.e1, p.bary[1]).addScaledVector(face.e2, p.bary[2]);
  }
  barycentric(point: THREE.Vector3, face: Face): [number, number, number] {
    tmp.copy(point).sub(face.a);
    const d20 = tmp.dot(face.e1), d21 = tmp.dot(face.e2);
    const v = (face.d11 * d20 - face.d01 * d21) * face.inverse;
    const w = (face.d00 * d21 - face.d01 * d20) * face.inverse;
    return [1 - v - w, v, w];
  }
  seed(count: number, seed = 20260930): Particle[] {
    const random = randomSource(seed), particles: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const area = random() * this.totalArea;
      let low = 0, high = this.cdf.length - 1;
      while (low < high) { const middle = (low + high) >> 1; if (this.cdf[middle] < area) low = middle + 1; else high = middle; }
      const root = Math.sqrt(random()), second = random();
      const p: Particle = { face: low, bary: [1 - root, root * (1 - second), root * second], position: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), crossings: 0 };
      const normal = this.faces[low].normal;
      p.up.addScaledVector(normal, -p.up.dot(normal));
      if (p.up.lengthSq() < .01) p.up.set(0, 0, 1).addScaledVector(normal, -normal.z);
      p.up.normalize();
      this.position(p); particles.push(p);
    }
    return particles;
  }
  /** Move a tangent displacement, unfolding it across adjacent triangle edges. */
  move(p: Particle, delta: THREE.Vector3) {
    displacement.copy(delta);
    // Pole fans can require many crossings within one otherwise short step.
    // Keep a finite cap for malformed meshes; never respawn on exhaustion.
    for (let iteration = 0; iteration < 96; iteration++) {
      const face = this.faces[p.face];
      // This projection removes only numerical normal drift after transport.
      displacement.addScaledVector(face.normal, -displacement.dot(face.normal));
      const d20 = displacement.dot(face.e1), d21 = displacement.dot(face.e2);
      const dv = (face.d11 * d20 - face.d01 * d21) * face.inverse;
      const dw = (face.d00 * d21 - face.d01 * d20) * face.inverse;
      const changes = [-dv - dw, dv, dw];
      let fraction = 1, edge = -1;
      for (let k = 0; k < 3; k++) {
        if (changes[k] < -1e-14) {
          const t = -p.bary[k] / changes[k];
          if (t >= -1e-9 && t < fraction) { fraction = Math.max(0, t); edge = k; }
        }
      }
      for (let k = 0; k < 3; k++) p.bary[k] += changes[k] * fraction;
      this.distanceTraveled += displacement.length() * fraction;
      this.position(p);
      if (edge < 0 || fraction >= 1 - 1e-10) return;
      const next = face.neighbors[edge];
      if (next < 0) { this.boundaryStops++; return; }
      const adjacent = this.faces[next];
      displacement.multiplyScalar(1 - fraction);
      turn.setFromUnitVectors(face.normal, adjacent.normal);
      displacement.applyQuaternion(turn);
      p.up.applyQuaternion(turn).normalize();
      p.face = next;
      p.bary = this.barycentric(p.position, adjacent);
      // A microscopic inset avoids repeated zero-time crossings due to roundoff.
      for (let k = 0; k < 3; k++) p.bary[k] = Math.max(1e-10, p.bary[k]);
      const sum = p.bary[0] + p.bary[1] + p.bary[2];
      for (let k = 0; k < 3; k++) p.bary[k] /= sum;
      this.position(p); this.crossings++; p.crossings++;
      if (displacement.lengthSq() < 1e-18) return;
    }
    this.iterationStops++;
  }
  step(particles: Particle[], dt: number, time: number, speed = .18) {
    omega.set(.18 * Math.sin(time * .11), 1, .16 * Math.cos(time * .13));
    for (const p of particles) {
      velocity.crossVectors(omega, p.position);
      velocity.x += .12 * Math.sin(p.position.y * 2.2 + time * .19);
      velocity.y += .12 * Math.sin(p.position.z * 2.4 + time * .17);
      velocity.z += .12 * Math.cos(p.position.x * 2.1 - time * .15);
      const normal = this.faces[p.face].normal;
      velocity.addScaledVector(normal, -velocity.dot(normal));
      const length = velocity.length();
      if (length > 1e-8) this.move(p, velocity.multiplyScalar(speed * dt / length));
    }
  }
  distance(point: THREE.Vector3): number {
    let closestSq = Infinity;
    const visit = (node: Node) => {
      const bound = node.box.distanceToPoint(point); if (bound * bound > closestSq) return;
      if (node.faces) {
        for (const id of node.faces) {
          const f = this.faces[id]; b.copy(f.a).add(f.e1); c.copy(f.a).add(f.e2);
          triangle.set(f.a, b, c).closestPointToPoint(point, nearest);
          closestSq = Math.min(closestSq, nearest.distanceToSquared(point));
        }
      } else {
        const l = node.left!, r = node.right!;
        if (l.box.distanceToPoint(point) < r.box.distanceToPoint(point)) { visit(l); visit(r); }
        else { visit(r); visit(l); }
      }
    };
    visit(this.bvh); return Math.sqrt(closestSq);
  }
}

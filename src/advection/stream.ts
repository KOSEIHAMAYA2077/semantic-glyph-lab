import { Quaternion, Vector3 } from 'three';
import { Surface, type Particle } from './surface';

const step = new Vector3(), velocity = new Vector3(), turn = new Quaternion();
const p1 = new Vector3(), p2 = new Vector3(), gradient = new Vector3();
const potentials = (p: Vector3) => [p.y, .3 * Math.sin(1.4 * p.x) * Math.cos(1.8 * p.z), .25 * Math.sin(2 * p.z) * Math.cos(1.2 * p.y), .2 * Math.sin(2 * p.x) * Math.cos(1.2 * p.y)];

/** Piecewise-linear scalar stream function; no velocity normalization or density solver. */
export class StreamField {
  private modes: Float64Array;
  private values: Float64Array;
  private stamps: Int32Array;
  private epoch = 0;
  private weights = [1, 0, 0, 0];
  distanceTraveled = 0;
  constructor(readonly surface: Surface) {
    this.modes = new Float64Array(surface.faces.length * 12);
    this.values = new Float64Array(surface.faces.length * 3);
    this.stamps = new Int32Array(surface.faces.length);
    surface.faces.forEach((f, id) => {
      const a = potentials(f.a), b = potentials(p1.copy(f.a).add(f.e1)), c = potentials(p2.copy(f.a).add(f.e2));
      for (let k = 0; k < 4; k++) {
        const d1 = b[k] - a[k], d2 = c[k] - a[k];
        gradient.copy(f.e1).multiplyScalar((f.d11 * d1 - f.d01 * d2) * f.inverse).addScaledVector(f.e2, (f.d00 * d2 - f.d01 * d1) * f.inverse);
        velocity.crossVectors(f.normal, gradient).multiplyScalar(.18);
        this.modes.set(velocity.toArray(), id * 12 + k * 3);
      }
    });
    this.setTime(0);
  }
  field(id: number, output: Vector3): Vector3 {
    if (this.stamps[id] !== this.epoch) {
      for (let xyz = 0; xyz < 3; xyz++) {
        let value = 0; for (let k = 0; k < 4; k++) value += this.modes[id * 12 + k * 3 + xyz] * this.weights[k];
        this.values[id * 3 + xyz] = value;
      }
      this.stamps[id] = this.epoch;
    }
    return output.fromArray(this.values, id * 3);
  }
  setTime(time: number) {
    this.epoch++; this.weights = [1, .6 * Math.sin(time * .19), .8 * Math.cos(time * .13), .7 * Math.sin(time * .11)];
  }
  step(particles: Particle[], dt: number, time: number) {
    this.setTime(time);
    for (const p of particles) this.move(p, dt);
  }
  private move(p: Particle, dt: number) {
    let remaining = dt;
    for (let iteration = 0; iteration < 96; iteration++) {
      const face = this.surface.faces[p.face];
      this.field(p.face, velocity); step.copy(velocity).multiplyScalar(remaining);
      const d20 = step.dot(face.e1), d21 = step.dot(face.e2);
      const dv = (face.d11 * d20 - face.d01 * d21) * face.inverse;
      const dw = (face.d00 * d21 - face.d01 * d20) * face.inverse;
      const changes = [-dv - dw, dv, dw];
      let fraction = 1, edge = -1;
      for (let k = 0; k < 3; k++) if (changes[k] < -1e-14) {
        const t = -p.bary[k] / changes[k];
        if (t >= -1e-9 && t < fraction) { fraction = Math.max(0, t); edge = k; }
      }
      for (let k = 0; k < 3; k++) p.bary[k] += changes[k] * fraction;
      this.distanceTraveled += step.length() * fraction;
      this.surface.position(p);
      if (edge < 0 || fraction >= 1 - 1e-10) return;
      const next = face.neighbors[edge];
      if (next < 0) { this.surface.boundaryStops++; return; }
      const adjacent = this.surface.faces[next];
      remaining *= 1 - fraction;
      turn.setFromUnitVectors(face.normal, adjacent.normal); p.up.applyQuaternion(turn).normalize();
      p.face = next; p.bary = this.surface.barycentric(p.position, adjacent);
      for (let k = 0; k < 3; k++) p.bary[k] = Math.max(1e-10, p.bary[k]);
      const sum = p.bary[0] + p.bary[1] + p.bary[2];
      for (let k = 0; k < 3; k++) p.bary[k] /= sum;
      this.surface.position(p); this.surface.crossings++; p.crossings++;
      if (remaining < 1e-12) return;
      // Reevaluate the field on the adjacent face for the remaining time.
    }
    this.surface.iterationStops++;
  }
}

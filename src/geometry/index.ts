import {
  BoxGeometry, BufferGeometry, ConeGeometry, CylinderGeometry, ExtrudeGeometry,
  Float32BufferAttribute, IcosahedronGeometry, LatheGeometry, Matrix4, Quaternion,
  Shape, SphereGeometry, TorusGeometry, TorusKnotGeometry, Vector2, Vector3,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { FormSpec, ObjectId } from '../types';

/** Deterministic, local shape vocabulary. Count is a scene placement concern. */
export const FORM_IDS: readonly ObjectId[] = [
  'sphere', 'cube', 'vase', 'sword', 'tree', 'flower', 'fish', 'bird',
  'chair', 'table', 'mug', 'bottle', 'house', 'tower', 'ring', 'star',
  'heart', 'knot', 'shell', 'cone', 'pyramid', 'rock', 'cloud', 'mushroom',
];

const vec = (x: number, y: number, z = 0) => new Vector3(x, y, z);
const clamp = (value: number, low: number, high: number, fallback: number) =>
  Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback;

function place(g: BufferGeometry, position = vec(0, 0), scale = vec(1, 1, 1), rotation = vec(0, 0)) {
  g.scale(scale.x, scale.y, scale.z);
  g.rotateX(rotation.x); g.rotateY(rotation.y); g.rotateZ(rotation.z);
  g.translate(position.x, position.y, position.z);
  return g;
}
function ball(position: Vector3, scale: Vector3) {
  return place(new SphereGeometry(1, 40, 28), position, scale);
}
function box(position: Vector3, size: Vector3) {
  return place(new BoxGeometry(size.x, size.y, size.z, 12, 16, 12), position);
}
function cylinder(a: Vector3, b: Vector3, radius: number, endRadius = radius) {
  const direction = b.clone().sub(a);
  const g = new CylinderGeometry(endRadius, radius, direction.length(), 40, 20);
  const q = new Quaternion().setFromUnitVectors(vec(0, 1), direction.normalize());
  g.applyMatrix4(new Matrix4().makeRotationFromQuaternion(q));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

/** An indexed UV surface. Pole triangles with zero area are omitted. */
function surface(nu: number, nv: number, sample: (u: number, v: number) => Vector3) {
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const p = sample(i / nu, j / nv);
    positions.push(p.x, p.y, p.z); uv.push(i / nu, j / nv);
  }
  const point = (i: number) => vec(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
  const triangle = (a: number, b: number, c: number) => {
    const p = point(a), q = point(b).sub(p), r = point(c).sub(p);
    if (q.cross(r).lengthSq() > 1e-16) indices.push(a, b, c);
  };
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    triangle(a, c, b); triangle(b, c, d);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(indices); g.computeVertexNormals();
  return g;
}

function lathe(profile: [number, number][]) {
  // More rings along each profile segment make later twisting/bending visible.
  const points: Vector2[] = [];
  profile.slice(0, -1).forEach((a, i) => {
    const b = profile[i + 1];
    const steps = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 26));
    for (let j = 0; j < steps; j++) {
      const t = j / steps;
      points.push(new Vector2(a[0] * (1 - t) + b[0] * t, a[1] * (1 - t) + b[1] * t));
    }
  });
  points.push(new Vector2(...profile[profile.length - 1]));
  return new LatheGeometry(points, 72);
}

function extrusion(shape: Shape, depth: number, bevel = 0.04) {
  return new ExtrudeGeometry(shape, {
    depth, steps: 12, curveSegments: 32,
    bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4,
  }).translate(0, 0, -depth / 2);
}
function polygon(points: [number, number][], depth: number, bevel = 0.025) {
  const shape = new Shape();
  points.forEach(([x, y], i) => i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y));
  shape.closePath(); return extrusion(shape, depth, bevel);
}

function baseParts(id: ObjectId): BufferGeometry[] {
  switch (id) {
    case 'sphere': return [new SphereGeometry(1, 72, 48)];
    case 'cube': return [new BoxGeometry(2, 2, 2, 28, 28, 28)];
    case 'vase': return [lathe([
      [0, -1.25], [.5, -1.25], [.68, -1.12], [.85, -.8], [.93, -.35],
      [.88, .08], [.68, .42], [.39, .7], [.3, 1.02], [.44, 1.23],
      [.45, 1.29], [.34, 1.29], [.21, 1.03], [.28, .7], [.55, .39],
      [.76, .03], [.81, -.35], [.72, -.76], [.5, -1.05], [0, -1.05],
    ])];
    case 'bottle': return [lathe([
      [0, -1.2], [.56, -1.2], [.62, -1.12], [.62, .35], [.56, .56],
      [.25, .81], [.24, 1.18], [.29, 1.18], [.29, 1.29], [.17, 1.29],
      [.17, .76], [.5, .42], [.5, -1.05], [0, -1.05],
    ])];
    case 'sword': return [
      surface(32, 60, (u, v) => {
        const a = u * Math.PI * 2;
        const end = v > .82 ? (1 - v) / .18 : 1;
        const width = (.25 - .065 * Math.min(v / .82, 1)) * end;
        // Diamond cross-section produces an actual blade ridge and broad faces.
        const norm = Math.abs(Math.cos(a)) + Math.abs(Math.sin(a));
        return vec(width * Math.cos(a) / norm, -.3 + v * 2.13, .075 * end * Math.sin(a) / norm);
      }),
      box(vec(0, -.37), vec(1.18, .15, .23)),
      cylinder(vec(0, -1.02), vec(0, -.43), .10),
      ball(vec(0, -1.12), vec(.18, .17, .13)),
    ];
    case 'tree': return [
      cylinder(vec(0, -1.4), vec(0, .8), .14, .09),
      place(new ConeGeometry(.93, 1.28, 48, 22), vec(0, -.03)),
      place(new ConeGeometry(.72, 1.18, 48, 22), vec(0, .58)),
      place(new ConeGeometry(.47, .97, 48, 22), vec(0, 1.1)),
    ];
    case 'flower': {
      const parts = [cylinder(vec(0, -1.6), vec(0, .4), .055), ball(vec(0, .6), vec(.29, .29, .16))];
      for (let i = 0; i < 7; i++) {
        const a = i * Math.PI * 2 / 7;
        parts.push(place(new SphereGeometry(1, 32, 24), vec(Math.sin(a) * .54, .6 + Math.cos(a) * .54), vec(.24, .49, .105), vec(0, 0, -a)));
      }
      parts.push(place(new SphereGeometry(1, 32, 24), vec(.32, -.66), vec(.39, .14, .065), vec(0, 0, .53)));
      parts.push(place(new SphereGeometry(1, 32, 24), vec(-.31, -.92), vec(.36, .13, .065), vec(0, 0, -.53)));
      return parts;
    }
    case 'fish': return [
      ball(vec(.14, 0), vec(.95, .48, .3)),
      polygon([[-.66, 0], [-1.35, .63], [-1.23, 0], [-1.35, -.63]], .15),
      polygon([[-.4, .32], [-.12, .83], [.37, .35]], .1),
      polygon([[-.15, -.29], [.07, -.74], [.48, -.34]], .09),
      ball(vec(.75, .14, .245), vec(.055, .055, .035)),
      ball(vec(.75, .14, -.245), vec(.055, .055, .035)),
    ];
    case 'bird': return [
      ball(vec(0, -.12), vec(.39, .72, .34)),
      ball(vec(0, .66), vec(.30, .30, .28)),
      cylinder(vec(0, .69, .21), vec(0, .61, .67), .15, 0),
      place(new SphereGeometry(1, 40, 24), vec(.72, .02), vec(.81, .20, .32), vec(0, .12, .28)),
      place(new SphereGeometry(1, 40, 24), vec(-.72, .02), vec(.81, .20, .32), vec(0, -.12, -.28)),
      polygon([[-.17, -.63], [-.45, -1.13], [.45, -1.13], [.17, -.63]], .13),
    ];
    case 'chair': {
      const parts = [box(vec(0, -.1), vec(1.4, .18, 1.3)), box(vec(0, .76, -.55), vec(1.4, 1.55, .18))];
      for (const x of [-.52, .52]) for (const z of [-.47, .47]) parts.push(box(vec(x, -.74, z), vec(.17, 1.25, .17)));
      return parts;
    }
    case 'table': {
      const parts = [box(vec(0, .51), vec(2.3, .17, 1.4))];
      for (const x of [-.93, .93]) for (const z of [-.49, .49]) parts.push(box(vec(x, -.16, z), vec(.17, 1.3, .17)));
      return parts;
    }
    case 'mug': return [
      lathe([[0, -.8], [.65, -.8], [.74, -.66], [.74, .74], [.65, .79], [.58, .73], [.58, -.58], [0, -.58]]),
      place(new TorusGeometry(.46, .115, 20, 64, Math.PI * 1.5), vec(.76, .02), vec(1, 1.15, 1), vec(0, 0, -Math.PI * .75)),
    ];
    case 'house': return [
      box(vec(0, -.42), vec(1.85, 1.35, 1.55)),
      polygon([[-1.13, .22], [0, 1.22], [1.13, .22]], 1.9, .02),
      box(vec(.58, .83, -.32), vec(.22, .78, .26)),
    ];
    case 'tower': {
      const parts: BufferGeometry[] = [cylinder(vec(0, -1.4), vec(0, 1.01), .57, .66), cylinder(vec(0, .94), vec(0, 1.11), .73)];
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2;
        parts.push(place(new BoxGeometry(.26, .34, .23, 5, 7, 5), vec(Math.sin(a) * .61, 1.24, Math.cos(a) * .61), vec(1, 1, 1), vec(0, a, 0)));
      }
      return parts;
    }
    case 'ring': return [new TorusGeometry(.91, .24, 36, 100)];
    case 'star': {
      const points: [number, number][] = [];
      for (let i = 0; i < 10; i++) {
        const angle = i * Math.PI / 5, r = i % 2 ? .47 : 1.13;
        points.push([Math.sin(angle) * r, Math.cos(angle) * r]);
      }
      return [polygon(points, .32, .06)];
    }
    case 'heart': {
      const shape = new Shape();
      shape.moveTo(0, -.99);
      shape.bezierCurveTo(-.16, -.7, -1.1, -.06, -1.1, .55);
      shape.bezierCurveTo(-1.1, 1.25, -.27, 1.39, 0, .78);
      shape.bezierCurveTo(.27, 1.39, 1.1, 1.25, 1.1, .55);
      shape.bezierCurveTo(1.1, -.06, .16, -.7, 0, -.99);
      return [extrusion(shape, .30, .14)];
    }
    case 'knot': return [new TorusKnotGeometry(.83, .22, 160, 24, 2, 3)];
    case 'shell': return [surface(128, 32, (u, v) => {
      const t = u * Math.PI * 4.8, a = v * Math.PI * 2;
      const r = .048 * Math.exp(.19 * t), tube = .033 + .35 * r;
      return vec((r + tube * Math.cos(a)) * Math.cos(t), (r + tube * Math.cos(a)) * Math.sin(t), tube * .82 * Math.sin(a));
    })];
    case 'cone': return [new ConeGeometry(1, 2.3, 72, 40)];
    case 'pyramid': return [place(new ConeGeometry(1.4, 2.2, 4, 40), vec(0, 0), vec(1, 1, 1), vec(0, Math.PI / 4, 0))];
    case 'rock': {
      const g = new IcosahedronGeometry(1, 4), positions = g.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
        const n = 1 + .12 * Math.sin(x * 4.4 + y * 3.1) * Math.cos(z * 5.7 - y * 2.8) + .07 * Math.sin(y * 9.3 + x * 4.5);
        positions.setXYZ(i, x * n, y * n * .83, z * n * .92);
      }
      return [g];
    }
    case 'cloud': return [
      ball(vec(-.71, -.08), vec(.65, .53, .55)), ball(vec(0, .17), vec(.72, .73, .65)),
      ball(vec(.78, -.13), vec(.62, .52, .52)), ball(vec(.21, -.29), vec(.88, .40, .61)),
    ];
    case 'mushroom': return [
      lathe([[0, 1.23], [.28, 1.17], [.59, 1.0], [.87, .7], [1.04, .4], [1.08, .27], [.85, .18], [.48, .18], [0, .29]]),
      lathe([[0, -1.2], [.32, -1.2], [.38, -.99], [.27, -.59], [.2, -.08], [.27, .37], [0, .42]]),
    ];
  }
}

/** Build a single mesh with UVs, surface normals and bounded attribute deformation. */
export function createForm(spec: FormSpec): BufferGeometry {
  const parts = baseParts(FORM_IDS.includes(spec.object) ? spec.object : 'sphere');
  const expanded = parts.map(g => g.index ? g.toNonIndexed() : g.clone());
  const combined = mergeGeometries(expanded, false);
  if (!combined) throw new Error('Unable to combine form surfaces');
  // Retain sharp source creases; weld identical duplicated triangle corners.
  const geometry = mergeVertices(combined, 1e-5);
  for (const g of [...parts, ...expanded, combined]) g.dispose();
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!;
  const center = bounds.getCenter(vec(0, 0)), size = bounds.getSize(vec(0, 0));
  const scale = 2.6 / Math.max(size.x, size.y, size.z, 1e-6);
  geometry.translate(-center.x, -center.y, -center.z); geometry.scale(scale, scale, scale);
  const half = size.multiplyScalar(scale / 2);
  // A box is already square: repeatedly asking for squareness must not inflate
  // its corners into a new, non-planar shape.
  const sq = spec.object === 'cube' ? 0 : clamp(spec.squareness, 0, 1, 0), exponent = 2 + sq * 18;
  const elongation = clamp(spec.elongation, .5, 2.5, 1);
  const twist = clamp(spec.twist, -1, 1, 0), bend = clamp(spec.bend, -1, 1, 0);
  const roughness = clamp(spec.roughness, 0, 1, 0);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    let x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    if (sq > 0) {
      const nx = x / half.x, ny = y / half.y, nz = z / half.z;
      const length = Math.hypot(nx, ny, nz);
      if (length > 1e-8) {
        const lp = (Math.abs(nx / length) ** exponent + Math.abs(ny / length) ** exponent + Math.abs(nz / length) ** exponent) ** (1 / exponent);
        const factor = 1 / lp;
        x *= factor; y *= factor; z *= factor;
      }
    }
    const noise = 1 + roughness * .085 * Math.sin(x * 4.8 + y * 2.3) * Math.cos(z * 5.1 - y * 3.7);
    x *= noise; y *= noise; z *= noise;
    const angle = twist * y * 1.45, c = Math.cos(angle), s = Math.sin(angle);
    const rx = x * c - z * s, rz = x * s + z * c;
    y *= elongation;
    x = rx + bend * .43 * (y * y - .4); z = rz;
    position.setXYZ(i, x, y, z);
  }
  position.needsUpdate = true;
  // Lathed poles/caps can repeat an axis vertex. Do not leave zero-area faces
  // for downstream area-weighted letter placement or generated-model comparison.
  const sourceIndex = geometry.getIndex()!, validFaces: number[] = [];
  const a = vec(0, 0), b = vec(0, 0), c = vec(0, 0);
  for (let i = 0; i < sourceIndex.count; i += 3) {
    const ia = sourceIndex.getX(i), ib = sourceIndex.getX(i + 1), ic = sourceIndex.getX(i + 2);
    a.fromBufferAttribute(position, ia); b.fromBufferAttribute(position, ib); c.fromBufferAttribute(position, ic);
    if (b.sub(a).cross(c.sub(a)).lengthSq() > 1e-16) validFaces.push(ia, ib, ic);
  }
  geometry.setIndex(validFaces);
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

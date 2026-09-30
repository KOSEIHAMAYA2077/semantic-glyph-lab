import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createForm } from '../geometry';
import { DEFAULT_FORM } from '../types';
import { LetterField } from '../letters';
import { Surface, type Particle } from './surface';
import { StreamField } from './stream';

const params = new URLSearchParams(location.search), count = 2000;
const flowMode = params.get('flow') === 'stream' ? 'stream' : 'normalized';
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setClearColor(0x000000);
document.querySelector('#stage')!.append(renderer.domElement);
const world = new THREE.Scene(), camera = new THREE.PerspectiveCamera(38, 1, .01, 30);
camera.position.set(0, .25, 6); const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.enablePan = false;
const field = new LetterField(); field.add('水面を渡る言葉。静かな流れと光のかけら。記憶、星、花、風、123@', 0, '#eeeeee');
const glyphGeometry = new THREE.PlaneGeometry(1, 1);
glyphGeometry.setAttribute('glyphIndex', new THREE.InstancedBufferAttribute(Float32Array.from({ length: count }, (_, i) => i % field.letters.length), 1));
const glyphMaterial = new THREE.ShaderMaterial({
  uniforms: { atlas: { value: field.texture }, grid: { value: field.grid } }, side: THREE.FrontSide, transparent: false,
  vertexShader: `attribute float glyphIndex; varying vec2 glyphUv; void main(){glyphUv=vec2(mod(glyphIndex,${field.grid.toFixed(1)})+uv.x, ${field.grid.toFixed(1)}-1.0-floor(glyphIndex/${field.grid.toFixed(1)})+uv.y)/${field.grid.toFixed(1)}; gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}`,
  fragmentShader: `uniform sampler2D atlas; varying vec2 glyphUv; void main(){vec3 ink=texture2D(atlas,glyphUv).rgb; if(max(ink.r,max(ink.g,ink.b))<.14)discard; gl_FragColor=vec4(ink,1.0);}`,
});
const glyphs = new THREE.InstancedMesh(glyphGeometry, glyphMaterial, count); glyphs.frustumCulled = false; glyphs.instanceMatrix.setUsage(THREE.DynamicDrawUsage); world.add(glyphs);
const bodyMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
const body = new THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>(new THREE.SphereGeometry(1), bodyMaterial); body.renderOrder = -1; world.add(body);
let surface: Surface, stream: StreamField | undefined, particles: Particle[] = [], paused = false, shape = '', time = 0, frames = 0, size = .09;
let ready = false, buildMs = 0, loadToken = 0;
const cpuTimes: number[] = [], frameTimes: number[] = [];
const dummy = new THREE.Object3D(), right = new THREE.Vector3(), up = new THREE.Vector3(), basis = new THREE.Matrix4();
function drawMatrices() {
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i], n = surface.faces[p.face].normal;
    up.copy(p.up).addScaledVector(n, -p.up.dot(n)).normalize();
    right.crossVectors(up, n).normalize(); basis.makeBasis(right, up, n);
    dummy.position.copy(p.position).addScaledVector(n, .002);
    dummy.quaternion.setFromRotationMatrix(basis); dummy.scale.setScalar(size); dummy.updateMatrix(); glyphs.setMatrixAt(i, dummy.matrix);
  }
  glyphs.instanceMatrix.needsUpdate = true;
}
async function geometryFor(id: string) {
  if (id !== 'generated') return createForm({ ...DEFAULT_FORM, object: id === 'vase' ? 'vase' : id === 'cube' ? 'cube' : 'sphere' });
  const url = '/generated/shap-e-vase-outer-shell-v1.glb';
  const bytes = await (await fetch(url)).arrayBuffer();
  const manager = new THREE.LoadingManager(); manager.setURLModifier(path => { if (path.startsWith('blob:') || path.startsWith('data:')) return path; throw new Error('External model reference rejected'); });
  const gltf = await new GLTFLoader(manager).parseAsync(bytes, ''); gltf.scene.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  gltf.scene.traverse(o => { if (o instanceof THREE.Mesh) { const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); g.applyMatrix4(o.matrixWorld); for (const key of Object.keys(g.attributes)) if (key !== 'position') g.deleteAttribute(key); parts.push(g); } });
  const geometry = mergeGeometries(parts, false)!; parts.forEach(p => p.dispose()); return geometry;
}
async function choose(id: string) {
  const token = ++loadToken; ready = false; document.body.dataset.ready = 'false'; document.querySelector('#status')!.textContent = '準備中';
  try {
    const geometry = await geometryFor(id); if (token !== loadToken) { geometry.dispose(); return; }
    geometry.computeBoundingBox(); const box = geometry.boundingBox!, center = box.getCenter(new THREE.Vector3()), extent = box.getSize(new THREE.Vector3());
    geometry.translate(-center.x, -center.y, -center.z); geometry.scale(2.6 / Math.max(extent.x, extent.y, extent.z), 2.6 / Math.max(extent.x, extent.y, extent.z), 2.6 / Math.max(extent.x, extent.y, extent.z));
    const started = performance.now(); surface = new Surface(geometry); stream = flowMode === 'stream' ? new StreamField(surface) : undefined; particles = surface.seed(count); buildMs = performance.now() - started;
    body.geometry.dispose(); body.geometry = geometry; shape = id; time = 0; frames = 0; cpuTimes.length = frameTimes.length = 0;
    drawMatrices(); ready = true; document.body.dataset.ready = 'true'; document.querySelector('#status')!.textContent = '';
    document.querySelectorAll<HTMLButtonElement>('[data-shape]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.shape === id)));
  } catch (error) { document.querySelector('#error')!.textContent = String(error); (document.querySelector('#error') as HTMLElement).hidden = false; throw error; }
}
const quantile = (values: number[], q: number) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0; };
function inspect() {
  let anchorMax = 0, cornerMax = 0, cornerSum = 0, cornerCount = 0, minBarycentric = 1;
  const heightBins = [0, 0, 0, 0, 0, 0, 0, 0];
  const bounds = body.geometry.boundingBox!, height = bounds.max.y - bounds.min.y;
  for (const p of particles) heightBins[Math.min(7, Math.max(0, Math.floor((p.position.y - bounds.min.y) / height * 8)))]++;
  // Sparse expensive nearest-surface checks are outside the animation frame timer.
  const corner = new THREE.Vector3(), r = new THREE.Vector3(), u = new THREE.Vector3();
  for (let i = 0; i < particles.length; i += 31) {
    const p = particles[i], n = surface.faces[p.face].normal;
    anchorMax = Math.max(anchorMax, surface.distance(p.position)); minBarycentric = Math.min(minBarycentric, ...p.bary);
    u.copy(p.up).addScaledVector(n, -p.up.dot(n)).normalize(); r.crossVectors(u, n).normalize();
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      corner.copy(p.position).addScaledVector(n, .002).addScaledVector(r, size * .5 * sx).addScaledVector(u, size * .5 * sy);
      const distance = surface.distance(corner); cornerMax = Math.max(cornerMax, distance); cornerSum += distance; cornerCount++;
    }
  }
  const gl = renderer.getContext(), info = gl.getExtension('WEBGL_debug_renderer_info');
  return { graphics: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'not exposed', shape, flowMode, count, size, time, frames, buildMs, triangles: surface.faces.length, area: surface.totalArea, crossings: surface.crossings, boundaryEdges: surface.boundaryEdges, nonManifoldEdges: surface.nonManifoldEdges, boundaryStops: surface.boundaryStops, iterationStops: surface.iterationStops, meanPathLength: (stream ? stream.distanceTraveled : surface.distanceTraveled) / count, heightBins, anchorDistanceMax: anchorMax, plateOffset: .002, cornerDistanceMax: cornerMax, cornerDistanceMean: cornerSum / cornerCount, sampledAnchors: Math.ceil(particles.length / 31), minBarycentric, cpuMsMedian: quantile(cpuTimes, .5), cpuMsP95: quantile(cpuTimes, .95), frameMsMedian: quantile(frameTimes, .5), frameMsP95: quantile(frameTimes, .95), renderer: { ...renderer.info.render } };
}
function step(dt: number) { if (!ready) return; time += dt; if (stream) stream.step(particles, dt, time); else surface.step(particles, dt, time); drawMatrices(); }
let last = performance.now(), statsAt = 0;
function frame(now: number) {
  const elapsed = (now - last) / 1000; last = now;
  if (ready) {
    const start = performance.now();
    if (!paused && !document.hidden) step(Math.min(.035, elapsed));
    controls.update(); renderer.render(world, camera); frames++;
    if (frames > 10 && !paused && !document.hidden) { cpuTimes.push(performance.now() - start); frameTimes.push(elapsed * 1000); if (cpuTimes.length > 900) { cpuTimes.shift(); frameTimes.shift(); } }
    if (now - statsAt > 1000) { statsAt = now; document.querySelector('#stats')!.textContent = `2000文字 / ${shape}\n面をまたいだ回数 ${surface.crossings}\n更新＋描画送信 ${quantile(cpuTimes, .5).toFixed(1)} ms\nフレーム間隔 ${quantile(frameTimes, .5).toFixed(1)} ms`; }
  }
  requestAnimationFrame(frame);
}
function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize(); requestAnimationFrame(frame);
document.querySelectorAll<HTMLButtonElement>('[data-shape]').forEach(button => button.addEventListener('click', () => choose(button.dataset.shape!)));
document.querySelector('#pause')!.addEventListener('click', () => { paused = !paused; document.querySelector('#pause')!.textContent = paused ? '再開' : '停止'; });
document.querySelector('#size')!.addEventListener('input', event => { size = Number((event.target as HTMLInputElement).value); drawMatrices(); });
document.querySelector('#mesh')!.addEventListener('change', event => bodyMaterial.color.setHex((event.target as HTMLInputElement).checked ? 0x151515 : 0x000000));
// Independent harness for deterministic comparisons, not a production app API.
Object.assign(window, { __advection: { inspect, choose, pause: (value = true) => { paused = value; }, step: (seconds: number) => { const n = Math.ceil(seconds * 60); for (let i = 0; i < n; i++) step(seconds / n); renderer.render(world, camera); return inspect(); }, setSize: (value: number) => { size = value; drawMatrices(); }, camera: (x: number, y: number, z: number) => { camera.position.set(x, y, z); controls.target.set(0, 0, 0); controls.update(); }, sample: () => particles.slice(0, 10).map(p => ({ face: p.face, bary: [...p.bary], position: p.position.toArray(), crossings: p.crossings })) } });
choose(params.get('shape') ?? 'sphere');

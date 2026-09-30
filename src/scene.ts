import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LetterField } from './letters';
import { createSurfaceMaterial } from './surface-material';
import { createForm } from './geometry';
import { compositionGroup, type Composition } from './composition';
import { deformImport } from './deform-import';
import { AdvectionLayer } from './advection/layer';
import { PresenceLayer } from './presence/layer';
import { MAX_BODY_DISPLACEMENT } from './body-motion';
import { FluidField } from './fluid/field';
import { fluidMaterial } from './fluid/material';
import { DEFAULT_FORM, type FormSpec } from './types';

export class SurfaceScene {
  readonly renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  readonly world = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, .01, 100);
  readonly field = new LetterField();
  readonly material = createSurfaceMaterial(this.field);
  readonly group = new THREE.Group();
  readonly controls: OrbitControls;
  spec: FormSpec = { ...DEFAULT_FORM };
  time = 0; paused = false; loaded = ''; frames = 0;
  private geometry = createForm(this.spec);
  private transition?: { from: Float32Array; to: Float32Array; normalsFrom: Float32Array; normalsTo: Float32Array; elapsed: number };
  private loadingToken = 0;
  private importedBase?: THREE.BufferGeometry;
  renderMode: 'texture' | 'advection' | 'fluid' | 'presence' = 'texture';
  private fluid?: FluidField;
  private fluidSurface?: THREE.ShaderMaterial;
  private fluidAccumulator=0;
  private advection?: AdvectionLayer | PresenceLayer;
  private advectionCopies: THREE.InstancedMesh[] = [];
  private flowTime = 0;
  invalidateLoads() { this.loadingToken++; }
  constructor(host: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute('aria-label', '文章に対応した立体の表面を文字が流れる表示');
    host.append(this.renderer.domElement); this.world.add(this.group);
    this.camera.position.set(0, .15, 6.2);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.enablePan = false;
    this.controls.autoRotate = true; this.controls.autoRotateSpeed = .25;
    this.controls.minDistance = 2.4; this.controls.maxDistance = 14;
    this.populate();
    const resize = () => { this.renderer.setSize(host.clientWidth, host.clientHeight); this.camera.aspect = host.clientWidth / host.clientHeight; this.camera.updateProjectionMatrix(); this.keepInFrame(this.geometry,this.spec.count); };
    new ResizeObserver(resize).observe(host); resize();
  }
  private populate() {
    this.advectionCopies.forEach(mesh=>mesh.dispose()); this.advectionCopies=[];
    this.advection?.dispose(); this.advection=undefined;
    this.group.clear();
    const count = this.spec.count;
    if(this.renderMode === 'advection') this.advection=new AdvectionLayer(this.geometry,this.field,4096);
    if(this.renderMode === 'presence') this.advection=new PresenceLayer(this.geometry,this.field,4096);
    for (let i = 0; i < count; i++) {
      let mesh: THREE.Object3D = new THREE.Mesh(this.geometry, this.renderMode==='fluid'?this.fluidSurface!:this.material);
      if(this.advection) {
        mesh=i===0?this.advection.group:this.advection.group.clone();
        if(i>0) {
          const original=this.advection.group.children.find(child=>child instanceof THREE.InstancedMesh) as THREE.InstancedMesh;
          mesh.traverse(child=>{if(child instanceof THREE.InstancedMesh){child.instanceMatrix=original.instanceMatrix;this.advectionCopies.push(child);}});
        }
      }
      if (count > 1) {
        const radius = count === 2 ? .85 : 1.3, a = i * Math.PI * 2 / count;
        mesh.position.set(Math.cos(a) * radius, Math.sin(a) * radius * .65, Math.sin(a + .3) * .35);
        mesh.scale.setScalar(count < 4 ? .52 : .36);
        mesh.rotation.y = a * .25;
      }
      this.group.add(mesh);
    }
  }
  setRenderMode(mode: 'texture' | 'advection' | 'fluid' | 'presence') {
    if(mode===this.renderMode)return;
    if(mode==='fluid'&&!this.fluid){
      this.fluid=new FluidField(this.renderer);
      this.fluidSurface=fluidMaterial(this.field,this.fluid.displacement);
      this.fluidSurface.vertexShader=this.material.vertexShader;
      for(const key of ['glyphs','grid','density','bodyMotion','bodyTime'])this.fluidSurface.uniforms[key]=this.material.uniforms[key];
    }
    if(this.transition) {
      (this.geometry.getAttribute('position') as THREE.BufferAttribute).array.set(this.transition.to);
      (this.geometry.getAttribute('normal') as THREE.BufferAttribute).array.set(this.transition.normalsTo);
      this.geometry.getAttribute('position').needsUpdate=this.geometry.getAttribute('normal').needsUpdate=true;
      this.transition=undefined;
    }
    this.fluidAccumulator=0;this.renderMode=mode;this.populate();
  }
  setForm(spec: FormSpec) {
    this.loadingToken++; const next = createForm(spec);
    this.importedBase?.dispose(); this.importedBase=undefined;
    this.keepInFrame(next,spec.count);
    const position = this.geometry.getAttribute('position'), target = next.getAttribute('position');
    if (this.renderMode==='texture' && !this.loaded && spec.object === this.spec.object && position.count === target.count) {
      this.transition = {
        from: new Float32Array(position.array), to: new Float32Array(target.array),
        normalsFrom: new Float32Array(this.geometry.getAttribute('normal').array),
        normalsTo: new Float32Array(next.getAttribute('normal').array), elapsed: 0,
      };
      next.dispose();
    } else { this.geometry.dispose(); this.geometry = next; this.transition = undefined; }
    this.loaded = ''; this.spec = { ...spec }; this.populate();
  }
  setImportedAttributes(spec: FormSpec) {
    if(!this.importedBase) return this.setForm(spec);
    const next=deformImport(this.importedBase,spec);
    this.geometry.dispose();this.geometry=next;this.transition=undefined;this.spec={...spec};
    this.keepInFrame(next,spec.count);this.populate();
  }
  private keepInFrame(geometry:THREE.BufferGeometry,count=1) {
    geometry.computeBoundingSphere();
    const radius=(geometry.boundingSphere!.radius+MAX_BODY_DISPLACEMENT)*(count>1?(count<4?.52:.36):1)+(count>1?1.5:0);
    const halfVertical=THREE.MathUtils.degToRad(this.camera.fov*.5);
    const half=Math.min(halfVertical,Math.atan(Math.tan(halfVertical)*this.camera.aspect));
    const required=radius/Math.sin(half)*1.08;
    const offset=this.camera.position.clone().sub(this.controls.target);
    if(offset.length()<required || offset.length()>required*1.65) this.camera.position.copy(this.controls.target).add(offset.setLength(Math.max(6.2,required)));
    this.controls.maxDistance=Math.max(14,required*1.5);
  }
  /** A close fit for the optional art entry, including all future view rotations. */
  fitToView() {
    this.geometry.computeBoundingSphere();
    const count=this.spec.count, scale=count>1?(count<4?.52:.36):1;
    const radius=(this.geometry.boundingSphere!.radius+MAX_BODY_DISPLACEMENT*this.material.uniforms.bodyMotion.value)*scale+(count>1?1.5:0);
    const height=this.renderer.getSize(new THREE.Vector2()).y;
    const vertical=Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov*.5))*Math.max(.5,(height-120)/height));
    const horizontal=Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov*.5))*this.camera.aspect*.94);
    const desired=radius/Math.sin(Math.min(vertical,horizontal))*1.015;
    const offset=this.camera.position.clone().sub(this.controls.target).setLength(desired);
    this.camera.position.copy(this.controls.target).add(offset);this.controls.maxDistance=Math.max(14,desired*2);
  }
  async loadGLB(url: string) {
    const token = ++this.loadingToken;
    const response = await fetch(url); if (!response.ok) throw new Error('モデルを読み込めませんでした。');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 50 * 1024 * 1024) throw new Error('この試作では50MB以下のGLBを使います。');
    const manager = new THREE.LoadingManager();
    manager.setURLModifier(path => {
      if (path.startsWith('blob:') || path.startsWith('data:')) return path;
      throw new Error('外部ファイルを参照するモデルは読み込めません。');
    });
    const gltf = await new GLTFLoader(manager).parseAsync(bytes, '');
    return this.installModel(gltf.scene, url, token);
  }
  async loadOBJ(url: string) {
    const token = ++this.loadingToken;
    const response = await fetch(url); if (!response.ok) throw new Error('素材を読み込めませんでした。');
    const text = await response.text();
    if (text.length > 10 * 1024 * 1024) throw new Error('素材が大きすぎます。');
    // Geometry only: OBJLoader does not fetch the referenced material library.
    return this.installModel(new OBJLoader().parse(text), url, token);
  }
  setComposition(data: Composition) {
    const group=compositionGroup(data);
    try { return this.installModel(group, `composition:${data.label}`, ++this.loadingToken); }
    finally { group.traverse(obj=>{ if(obj instanceof THREE.Mesh) { obj.geometry.dispose(); const mats=Array.isArray(obj.material)?obj.material:[obj.material]; mats.forEach(m=>m.dispose()); } }); }
  }
  private installModel(root: THREE.Object3D, url: string, token: number) {
    root.updateMatrixWorld(true);
    const geometries: THREE.BufferGeometry[] = [];
    root.traverse(obj => {
      if (!(obj instanceof THREE.Mesh) || !obj.geometry.getAttribute('position')) return;
      const geometry = obj.geometry.index ? obj.geometry.toNonIndexed() : obj.geometry.clone();
      geometry.applyMatrix4(obj.matrixWorld);
      for (const key of Object.keys(geometry.attributes)) if (key !== 'position' && key !== 'normal' && key !== 'uv') geometry.deleteAttribute(key);
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      if (!geometry.getAttribute('uv')) geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 2), 2));
      geometries.push(geometry);
    });
    if (!geometries.length) throw new Error('三角形の面が含まれていません。');
    const merged = mergeGeometries(geometries, false)!;
    for (const g of geometries) g.dispose();
    merged.computeBoundingBox();
    const box = merged.boundingBox!, size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const max = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(max) || max <= 0 || merged.getAttribute('position').count > 2_000_000) { merged.dispose(); throw new Error('形のサイズまたは面数を確認できませんでした。'); }
    merged.translate(-center.x, -center.y, -center.z); merged.scale(2.6 / max, 2.6 / max, 2.6 / max);
    if (token !== this.loadingToken) { merged.dispose(); return false; }
    this.importedBase?.dispose();this.importedBase=merged.clone();
    this.geometry.dispose(); this.geometry = merged; this.transition = undefined;
    this.spec = { ...DEFAULT_FORM }; this.loaded = url; this.keepInFrame(merged);this.populate(); return true;
  }
  render(dt: number) {
    const step = this.paused ? 0 : dt;
    this.time += step;
    if (this.transition) {
      const t = this.transition; t.elapsed += step;
      const k = Math.min(1, t.elapsed / 1.6), ease = k * k * (3 - 2 * k);
      const pos = this.geometry.getAttribute('position') as THREE.BufferAttribute;
      const normal = this.geometry.getAttribute('normal') as THREE.BufferAttribute;
      for (let i = 0; i < t.from.length; i++) { pos.array[i] = t.from[i] + (t.to[i] - t.from[i]) * ease; normal.array[i] = t.normalsFrom[i] + (t.normalsTo[i] - t.normalsFrom[i]) * ease; }
      pos.needsUpdate = normal.needsUpdate = true;
      this.geometry.computeBoundingSphere();
      if (k === 1) this.transition = undefined;
    }
    this.field.refresh(this.time); this.material.uniforms.grid.value = this.field.grid;
    this.material.uniforms.time.value = this.time;this.material.uniforms.bodyTime.value=this.time;
    const flowStep=Math.min(step,.035)*this.material.uniforms.flow.value;
    this.flowTime+=flowStep;
    if(this.advection) {
      this.advection.setBodyMotion(this.time,this.material.uniforms.bodyMotion.value);
      // Substeps preserve the speed control even though the walker caps dt.
      const steps=Math.max(1,Math.ceil(flowStep/.035));
      for(let i=0;i<steps;i++) this.advection.update(flowStep/steps,this.flowTime,(this.renderMode==='presence'?15:1.4)/this.material.uniforms.density.value);
    }
    if(this.renderMode==='fluid'&&this.fluid&&this.fluidSurface){
      // At most six steps per frame. A hidden tab never accumulates catch-up work.
      this.fluidAccumulator=Math.min(.1,this.fluidAccumulator+flowStep);
      while(this.fluidAccumulator+1e-9>=this.fluid.fixedDt){this.fluid.step();this.fluidAccumulator-=this.fluid.fixedDt;}
      this.fluidSurface.uniforms.displacement.value=this.fluid.displacement;
    }
    if (!this.paused) this.controls.update(step);
    this.renderer.render(this.world, this.camera); this.frames++;
  }
  inspect() {
    this.geometry.computeBoundingBox();
    return { spec: { ...this.spec }, letters: this.field.letters.map(l => ({ ...l })), count: this.field.letters.length,
      time: this.time, camera: this.camera.position.toArray(), paused: this.paused, loaded: this.loaded, vertices: this.geometry.getAttribute('position').count,
      bounds: { min: this.geometry.boundingBox!.min.toArray(), max: this.geometry.boundingBox!.max.toArray() },
      flow: this.material.uniforms.flow.value, renderMode:this.renderMode, bodyMotion:this.material.uniforms.bodyMotion.value, frames: this.frames, renderer: this.renderer.info.render,
      fluid:this.fluid?{steps:this.fluid.steps,time:this.fluid.time}:null,
      gpuError:this.renderer.getContext().getError() };
  }
  inspectPresence(){return this.advection instanceof PresenceLayer ? this.advection.inspect() : null;}
  inspectFluid(){return this.fluid?.inspect();}
  resetFluid(){
    this.fluid?.reset();this.fluidAccumulator=0;
    if(this.fluid&&this.fluidSurface)this.fluidSurface.uniforms.displacement.value=this.fluid.displacement;
  }
}

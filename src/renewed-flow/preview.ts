import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createForm} from '../geometry';
import {DEFAULT_FORM} from '../types';
import {LetterField} from '../letters';
import {createSurfaceMaterial} from '../surface-material';
import {RenewedFluidField} from './field';
import {renewedMaterial} from './material';
import {fluidMaterial} from '../fluid/material';

const params=new URLSearchParams(location.search),renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(1);renderer.setClearColor(0);renderer.outputColorSpace=THREE.SRGBColorSpace;document.querySelector('#stage')!.append(renderer.domElement);
const world=new THREE.Scene(),camera=new THREE.PerspectiveCamera(38,1,.01,30);camera.position.set(0,.25,6.2);
const controls=new OrbitControls(camera,renderer.domElement);controls.enablePan=false;controls.enableDamping=true;
const field=new LetterField();field.add('あいうえお 水木花風雨 月星空海光 ABCDEFGHIJKLMNOP 0123456789 @?',0,'#ffffff');
const requestedForce=Number(params.get('force')??'.4');
const solver=new RenewedFluidField(renderer,{corrected:params.get('transport')==='corrected',forceScale:Number.isFinite(requestedForce)?Math.max(0,Math.min(2,requestedForce)):.4,manualInterpolation:params.get('interpolation')!=='hardware'}),fluid=fluidMaterial(field,solver.displacement),baseline=createSurfaceMaterial(field),renewed=renewedMaterial(field,solver.renewalTextures);
const body=new THREE.Mesh<THREE.BufferGeometry,THREE.ShaderMaterial>(new THREE.SphereGeometry(1),fluid);world.add(body);
let ready=false,shape='sphere',mode=params.get('mode')??'renew',paused=params.get('paused')==='1',steps=0,accumulator=0,token=0,advancing=false;
const fixedDt=1/60,cpuTimes:number[]=[],frameTimes:number[]=[];let previous=performance.now(),statAt=0;
const quantile=(values:number[],q:number)=>{const s=[...values].sort((a,b)=>a-b);return s[Math.max(0,Math.ceil(s.length*q)-1)]??0;};
function render(){renewed.uniforms.mapA.value=solver.renewalTextures[0];renewed.uniforms.mapB.value=solver.renewalTextures[1];renewed.uniforms.weightA.value=solver.phase.weightA;baseline.uniforms.time.value=steps*fixedDt;fluid.uniforms.displacement.value=solver.displacement;renderer.render(world,camera);}
function reset(){solver.reset();steps=0;accumulator=0;cpuTimes.length=frameTimes.length=0;render();showStats();}
function setMode(value:string){mode=['fluid','renew','coordinates'].includes(value)?value:'renew';body.material=mode==='fluid'?fluid:renewed;renewed.uniforms.coordinateBlend.value=mode==='coordinates';(document.querySelector('#mode') as HTMLSelectElement).value=mode;render();showStats();}
function pause(value=true){paused=value;(document.querySelector('#pause') as HTMLButtonElement).textContent=value?'再開':'停止';accumulator=0;}
function step(){solver.step();steps++;}
async function geometryFor(value:string){
  if(value!=='can')return createForm({...DEFAULT_FORM,object:value==='vase'?'vase':'sphere'});
  const bytes=await(await fetch('/end-to-end-models/paired-v1/watering-can-image-triposr.glb')).arrayBuffer();
  const manager=new THREE.LoadingManager();manager.setURLModifier(path=>{if(path.startsWith('blob:')||path.startsWith('data:'))return path;throw Error('External model resource rejected');});
  const gltf=await new GLTFLoader(manager).parseAsync(bytes,'');gltf.scene.updateMatrixWorld(true);
  const geometries:THREE.BufferGeometry[]=[];gltf.scene.traverse(object=>{if(object instanceof THREE.Mesh){const g=object.geometry.index?object.geometry.toNonIndexed():object.geometry.clone();g.applyMatrix4(object.matrixWorld);for(const key of Object.keys(g.attributes))if(key!=='position'&&key!=='normal')g.deleteAttribute(key);if(!g.getAttribute('normal'))g.computeVertexNormals();geometries.push(g);}});
  const merged=mergeGeometries(geometries,false)!;geometries.forEach(g=>g.dispose());gltf.scene.traverse(object=>{if(object instanceof THREE.Mesh){object.geometry.dispose();for(const m of Array.isArray(object.material)?object.material:[object.material])m.dispose();}});return merged;
}
async function choose(value:string,keepTime=false){
  const loading=++token;ready=false;document.body.dataset.ready='false';
  const geometry=await geometryFor(value);if(loading!==token){geometry.dispose();return;}
  geometry.computeBoundingBox();const center=geometry.boundingBox!.getCenter(new THREE.Vector3()),size=geometry.boundingBox!.getSize(new THREE.Vector3()),scale=2.6/Math.max(size.x,size.y,size.z);
  geometry.translate(-center.x,-center.y,-center.z);geometry.scale(scale,scale,scale);body.geometry.dispose();body.geometry=geometry;shape=value;
  document.querySelector('#attribution')!.textContent=value==='can'?'Powered by Stability AI':'';
  (document.querySelector('#shape') as HTMLSelectElement).value=value;if(!keepTime)reset();else render();ready=true;document.body.dataset.ready='true';
}
function inspect(){const gl=renderer.getContext(),info=gl.getExtension('WEBGL_debug_renderer_info');return {shape,mode,paused,steps,time:steps*fixedDt,letters:field.letters.length,grid:field.grid,triangles:body.geometry.index?body.geometry.index.count/3:body.geometry.getAttribute('position').count/3,graphics:info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):null,cpuMsMedian:quantile(cpuTimes,.5),cpuMsP95:quantile(cpuTimes,.95),frameMsMedian:quantile(frameTimes,.5),frameMsP95:quantile(frameTimes,.95),simulation:solver.inspect(),renewal:solver.inspectRenewal(),memory:{...renderer.info.memory},gpuError:gl.getError()};}
async function advance(seconds:number){
  if(!Number.isFinite(seconds)||seconds<0||seconds>120)throw Error('Advance must be within 0..120 seconds');
  advancing=true;try{const n=Math.round(seconds/fixedDt);for(let i=0;i<n;i++){step();if(i%60===59){render();await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));}}render();showStats();return inspect();}finally{advancing=false;}
}
function showStats(){document.querySelector('#stats')!.textContent=`${shape} / ${mode}\n${(steps*fixedDt).toFixed(1)} s / seed ${solver.seed}\nmap A ${(100*solver.phase.weightA).toFixed(0)}% / 60秒ごとに交替`;}
function frame(now:number){const elapsed=(now-previous)/1000;previous=now;
  if(ready&&!advancing){const start=performance.now();if(!paused&&!document.hidden){accumulator=Math.min(.1,accumulator+elapsed);while(accumulator+1e-9>=fixedDt){step();accumulator-=fixedDt;}cpuTimes.push(performance.now()-start);frameTimes.push(elapsed*1000);if(cpuTimes.length>600){cpuTimes.shift();frameTimes.shift();}}controls.update();render();}
  if(now-statAt>1000){statAt=now;showStats();}
  requestAnimationFrame(frame);
}
function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}
addEventListener('resize',resize);resize();setMode(mode);pause(paused);
document.querySelector('#pause')!.addEventListener('click',()=>pause(!paused));document.querySelector('#reset')!.addEventListener('click',reset);
document.querySelector('#shape')!.addEventListener('change',event=>void choose((event.target as HTMLSelectElement).value));document.querySelector('#mode')!.addEventListener('change',event=>setMode((event.target as HTMLSelectElement).value));
Object.assign(window,{__renew:{inspect,choose,mode:setMode,pause,reset,advance,probe:()=>{const result=solver.projectionProbe();reset();return result;},sample:()=>solver.sample(),camera:(x:number,y:number,z:number)=>{camera.position.set(x,y,z);controls.update();render();}}});
choose(params.get('shape')??'sphere').catch(error=>{document.querySelector('#error')!.textContent=String(error);});requestAnimationFrame(frame);

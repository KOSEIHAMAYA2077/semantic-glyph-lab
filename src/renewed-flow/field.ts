import * as THREE from 'three';
import { renewalPhase, mapMetrics } from './renewal';
import {divergence,rms} from '../fluid/operators';

const vertex=`varying vec2 texUv;void main(){texUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;
const common=`precision highp float;varying vec2 texUv;uniform float h,dt,time;uniform sampler2D source,velocity,pressure,divergenceMap;
vec4 bilinear(sampler2D field,vec2 q){
#ifdef MANUAL_INTERPOLATION
vec2 cell=q/h-.5,weight=fract(cell),base=(floor(cell)+.5)*h;
return mix(mix(texture2D(field,base),texture2D(field,base+vec2(h,0.)),weight.x),mix(texture2D(field,base+vec2(0.,h)),texture2D(field,base+vec2(h,h)),weight.x),weight.y);
#else
return texture2D(field,q);
#endif
}`;
const centerVelocity=`vec2 centered(vec2 q){return vec2(.5*(bilinear(velocity,q).x+bilinear(velocity,q-vec2(h,0.)).x),.5*(bilinear(velocity,q).y+bilinear(velocity,q-vec2(0.,h)).y));}`;
const advectVelocity=`
  vec2 atU(vec2 q){return vec2(texture2D(velocity,q).x,.25*(texture2D(velocity,q).y+texture2D(velocity,q+vec2(h,0.)).y+texture2D(velocity,q-vec2(0.,h)).y+texture2D(velocity,q+vec2(h,-h)).y));}
  vec2 atV(vec2 q){return vec2(.25*(texture2D(velocity,q).x+texture2D(velocity,q-vec2(h,0.)).x+texture2D(velocity,q+vec2(0.,h)).x+texture2D(velocity,q+vec2(-h,h)).x),texture2D(velocity,q).y);}
  void main(){vec2 u=atU(texUv),v=atV(texUv);vec2 result=vec2(bilinear(velocity,texUv-dt*u).x,bilinear(velocity,texUv-dt*v).y);gl_FragColor=vec4(result*exp(-.1*dt),0.,1.);}`;
const force=`uniform vec4 vortices[4];uniform float phases[4],forceScale;
  float psi(vec2 q){float value=0.;for(int i=0;i<4;i++){vec4 vortex=vortices[i];vec2 center=vortex.xy+vec2(.035*sin(time*.083+phases[i]),.027*cos(time*.061+phases[i]*1.7));vec2 d=fract(q-center+.5)-.5;value+=vortex.w*exp(-dot(d,d)/(vortex.z*vortex.z));}return value;}
  void main(){float a=psi(texUv+vec2(.5*h,.5*h));vec2 acceleration=vec2(a-psi(texUv+vec2(.5*h,-.5*h)),-a+psi(texUv+vec2(-.5*h,.5*h)))/h;gl_FragColor=vec4(texture2D(velocity,texUv).xy+dt*forceScale*acceleration,0.,1.);}`;
const divergenceShader=`void main(){vec2 here=texture2D(velocity,texUv).xy;float d=(here.x-texture2D(velocity,texUv-vec2(h,0.)).x+here.y-texture2D(velocity,texUv-vec2(0.,h)).y)/h;gl_FragColor=vec4(d,0.,0.,1.);}`;
const jacobi=`void main(){float p=(texture2D(pressure,texUv-vec2(h,0.)).x+texture2D(pressure,texUv+vec2(h,0.)).x+texture2D(pressure,texUv-vec2(0.,h)).x+texture2D(pressure,texUv+vec2(0.,h)).x-h*h*texture2D(divergenceMap,texUv).x)*.25;gl_FragColor=vec4(p,0.,0.,1.);}`;
const project=`void main(){float p=texture2D(pressure,texUv).x;vec2 gradient=vec2(texture2D(pressure,texUv+vec2(h,0.)).x-p,texture2D(pressure,texUv+vec2(0.,h)).x-p)/h;gl_FragColor=vec4(texture2D(velocity,texUv).xy-gradient,0.,1.);}`;
// Advect displacement rather than absolute UV, so bilinear sampling is continuous
// through periodic boundaries. Original glyph RGB is never fed through this grid.
const transport=`${centerVelocity}void main(){vec2 v=centered(texUv);vec2 travel=dt*centered(texUv-.5*dt*v);vec2 d=bilinear(source,texUv-travel).xy-travel;gl_FragColor=vec4(d,0.,1.);}`;
// MacCormack forward/backward error correction. Clamp against the four departure
// neighbors, so the sharper mapping does not introduce new coordinate extrema.
const correctTransport=`uniform sampler2D forwardMap;${centerVelocity}
void main(){vec2 v=centered(texUv),backwardTravel=dt*centered(texUv-.5*dt*v),forwardTravel=dt*centered(texUv+.5*dt*v);
vec2 first=texture2D(forwardMap,texUv).xy,reverse=bilinear(forwardMap,texUv+forwardTravel).xy+forwardTravel;
vec2 corrected=first+.5*(texture2D(source,texUv).xy-reverse);
vec2 base=(floor((texUv-backwardTravel)/h-.5)+.5)*h;
vec2 a=texture2D(source,base).xy,b=texture2D(source,base+vec2(h,0.)).xy,c=texture2D(source,base+vec2(0.,h)).xy,d=texture2D(source,base+vec2(h,h)).xy;
vec2 low=min(min(a,b),min(c,d))-backwardTravel,high=max(max(a,b),max(c,d))-backwardTravel;
gl_FragColor=vec4(clamp(corrected,low,high),0.,1.);}`;
const compressive=`void main(){vec2 v=vec2(.03*sin(6.28318530718*8.*(texUv.x+.5*h)),.025*sin(6.28318530718*11.*(texUv.y+.5*h)));gl_FragColor=vec4(v,0.,1.);}`;

/** Experimental fork of FluidField. One shared velocity transports the original
 * uninterrupted map plus two independently renewed maps. Old solver stays intact.
 * Not an intrinsic 3D surface solver or a reproduction of the surveyed papers. */
export class RenewedFluidField {
  readonly periodSteps = 3600;
  private renewalMaps: THREE.WebGLRenderTarget[][];
  private resets = [0, 0];
  readonly size:number;readonly fixedDt=1/60;readonly seed:number;readonly pressureIterations:number;readonly corrected:boolean;readonly forceScale:number;readonly manualInterpolation:boolean;
  time=0;steps=0;
  private quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2));
  private scene=new THREE.Scene();private camera=new THREE.Camera();
  private velocities:THREE.WebGLRenderTarget[];private pressures:THREE.WebGLRenderTarget[];private maps:THREE.WebGLRenderTarget[];
  private preDivergence:THREE.WebGLRenderTarget;
  private forwardMap:THREE.WebGLRenderTarget;
  private materials:Record<string,THREE.ShaderMaterial>={};
  constructor(private renderer:THREE.WebGLRenderer,options:{size?:number;seed?:number;iterations?:number;corrected?:boolean;forceScale?:number;manualInterpolation?:boolean}={}){
    this.size=options.size??128;this.seed=options.seed??20260930;this.pressureIterations=options.iterations??40;this.corrected=options.corrected??false;this.forceScale=options.forceScale??.4;this.manualInterpolation=options.manualInterpolation??true;
    if(!renderer.extensions.has('EXT_color_buffer_float')||!renderer.extensions.has('OES_texture_float_linear'))throw Error('Float render targets and linear sampling are required');
    const target=(linear=false)=>new THREE.WebGLRenderTarget(this.size,this.size,{type:THREE.FloatType,format:THREE.RGBAFormat,minFilter:linear?THREE.LinearFilter:THREE.NearestFilter,magFilter:linear?THREE.LinearFilter:THREE.NearestFilter,wrapS:THREE.RepeatWrapping,wrapT:THREE.RepeatWrapping,depthBuffer:false,stencilBuffer:false,generateMipmaps:false});
    this.velocities=[target(true),target(true)];this.pressures=[target(),target()];this.maps=[target(true),target(true)];this.preDivergence=target();this.forwardMap=target(true);
    this.renewalMaps=[[target(true),target(true)],[target(true),target(true)]];
    let seed=this.seed>>>0;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
    const vortices=Array.from({length:4},(_,i)=>new THREE.Vector4(.15+random()*.7,.15+random()*.7,.09+random()*.06,(i%2?-1:1)*(.000025+random()*.000015)));
    const phases=Array.from({length:4},()=>random()*Math.PI*2);
    for(const [name,shader] of Object.entries({advectVelocity,force,divergence:divergenceShader,jacobi,project,transport,correctTransport,compressive,zero:'void main(){gl_FragColor=vec4(0.);}' })){
      this.materials[name]=new THREE.ShaderMaterial({defines:this.manualInterpolation?{MANUAL_INTERPOLATION:1}:{},vertexShader:vertex,fragmentShader:common+shader,depthTest:false,depthWrite:false,uniforms:{h:{value:1/this.size},dt:{value:this.fixedDt},time:{value:0},source:{value:null},velocity:{value:null},pressure:{value:null},divergenceMap:{value:this.preDivergence.texture},forwardMap:{value:this.forwardMap.texture},vortices:{value:vortices},phases:{value:phases},forceScale:{value:this.forceScale}}});
    }
    this.scene.add(this.quad);this.reset();
  }
  get displacement(){return this.maps[0].texture;}
  get renewalTextures(){return this.renewalMaps.map(pair=>pair[0].texture);}
  get phase(){return renewalPhase(this.steps,this.periodSteps);}
  private renew(){
    const baseline=this.maps;
    for(let i=0;i<2;i++){
      this.maps=this.renewalMaps[i];
      this.pass('transport',this.maps[1]);this.maps.reverse();
      if(this.phase.reset===i){for(const target of this.maps)this.pass('zero',target);this.resets[i]++;}
    }
    this.maps=baseline;
  }
  inspectRenewal(){
    return {periodSteps:this.periodSteps,periodSeconds:this.periodSteps*this.fixedDt,phase:this.phase,resets:[...this.resets],baseline:mapMetrics(this.read(this.maps[0]),this.size),maps:this.renewalMaps.map(pair=>mapMetrics(this.read(pair[0]),this.size))};
  }
  private pass(name:string,to:THREE.WebGLRenderTarget){
    const previous=this.renderer.getRenderTarget(),material=this.materials[name];
    material.uniforms.time.value=this.time;material.uniforms.source.value=this.maps[0].texture;material.uniforms.velocity.value=this.velocities[0].texture;material.uniforms.pressure.value=this.pressures[0].texture;
    this.quad.material=material;this.renderer.setRenderTarget(to);this.renderer.render(this.scene,this.camera);this.renderer.setRenderTarget(previous);
  }
  reset(){
    for(const target of [...this.velocities,...this.pressures,...this.maps,...this.renewalMaps.flat(),this.preDivergence,this.forwardMap])this.pass('zero',target);
    this.time=0;this.steps=0;this.resets=[0,0];
  }
  private projection(iterations=this.pressureIterations){
    this.pass('divergence',this.preDivergence);
    for(let i=0;i<iterations;i++){this.pass('jacobi',this.pressures[1]);this.pressures.reverse();}
    this.pass('project',this.velocities[1]);this.velocities.reverse();
  }
  step(){
    this.time=(++this.steps)*this.fixedDt;
    this.pass('advectVelocity',this.velocities[1]);this.velocities.reverse();
    this.pass('force',this.velocities[1]);this.velocities.reverse();
    this.projection();
    if(this.corrected){this.pass('transport',this.forwardMap);this.pass('correctTransport',this.maps[1]);}
    else this.pass('transport',this.maps[1]);
    this.maps.reverse();
    this.renew();
  }
  private read(target:THREE.WebGLRenderTarget){const values=new Float32Array(this.size*this.size*4);this.renderer.readRenderTargetPixels(target,0,0,this.size,this.size,values);return values;}
  inspect(){
    const velocity=this.read(this.velocities[0]),map=this.read(this.maps[0]),p=this.read(this.pressures[0]),before=this.read(this.preDivergence);
    const beforeScalar=Float32Array.from({length:this.size*this.size},(_,i)=>before[i*4]),after=divergence(velocity,this.size);
    let maxSpeed=0,maxDisplacement=0,minDet=Infinity,maxDet=-Infinity,sumDet=0,nonPositive=0;
    for(let y=0;y<this.size;y++)for(let x=0;x<this.size;x++){
      const i=y*this.size+x;maxSpeed=Math.max(maxSpeed,Math.hypot(velocity[i*4],velocity[i*4+1]));maxDisplacement=Math.max(maxDisplacement,Math.hypot(map[i*4],map[i*4+1]));
      const l=(y*this.size+(x+this.size-1)%this.size)*4,r=(y*this.size+(x+1)%this.size)*4,d=(((y+this.size-1)%this.size)*this.size+x)*4,u=(((y+1)%this.size)*this.size+x)*4,k=this.size*.5;
      const xx=1+(map[r]-map[l])*k,xy=(map[u]-map[d])*k,yx=(map[r+1]-map[l+1])*k,yy=1+(map[u+1]-map[d+1])*k,det=xx*yy-xy*yx;
      minDet=Math.min(minDet,det);maxDet=Math.max(maxDet,det);sumDet+=det;if(det<=0)nonPositive++;
    }
    const finite=[velocity,map,p,before].every(values=>values.every(Number.isFinite)),preRms=rms(beforeScalar),postRms=rms(after);
    return {size:this.size,seed:this.seed,steps:this.steps,time:this.time,fixedDt:this.fixedDt,pressureIterations:this.pressureIterations,transport:this.corrected?'corrected':'first-order',forceScale:this.forceScale,interpolation:this.manualInterpolation?'manual':'hardware',finite,divergenceBeforeRms:preRms,divergenceAfterRms:postRms,divergenceRatio:preRms>1e-12?postRms/preRms:null,maxSpeedUVPerSecond:maxSpeed,maxDisplacementUV:maxDisplacement,mapJacobian:{min:minDet,max:maxDet,mean:sumDet/(this.size*this.size),nonPositive},gpuError:this.renderer.getContext().getError()};
  }
  projectionProbe(){
    this.reset();this.pass('compressive',this.velocities[0]);const before=this.read(this.velocities[0]);
    this.projection(100);const result={...this.inspect(),probe:'periodic frequency 8/11 compressive velocity',iterations:100,inputVelocity:Array.from(before),outputVelocity:Array.from(this.read(this.velocities[0]))};
    this.reset();return result;
  }
  sample(){return {velocity:Array.from(this.read(this.velocities[0]).slice(0,64)),displacement:Array.from(this.read(this.maps[0]).slice(0,64))};}
  dispose(){for(const target of [...this.velocities,...this.pressures,...this.maps,...this.renewalMaps.flat(),this.preDivergence,this.forwardMap])target.dispose();for(const material of Object.values(this.materials))material.dispose();this.quad.geometry.dispose();}
}

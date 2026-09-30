import './style.css';
import * as THREE from 'three';
import { SurfaceScene } from '../scene';
import { localInterpret } from '../local-interpret';
import { DEFAULT_FORM, type ObjectId, type FormSpec } from '../types';
import { graphemes, MAX_LETTERS } from '../letters';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const scene = new SurfaceScene($('scene'));
scene.setRenderMode('presence');
scene.material.uniforms.bodyMotion.value = .6;
scene.material.uniforms.flow.value = .75;
scene.material.uniforms.density.value = 15 / 1.2;
scene.controls.autoRotateSpeed = .18;
scene.camera.position.set(3.2, 1.3, 4.2);
scene.controls.minDistance = 2.8;
scene.group.visible = false;
scene.controls.update();
const labels: Record<ObjectId, string> = {sphere:'球体',cube:'立方体',vase:'花瓶',sword:'剣',tree:'木',flower:'花',fish:'魚',bird:'鳥',chair:'椅子',table:'机',mug:'カップ',bottle:'瓶',house:'家',tower:'塔',ring:'円環',star:'星',heart:'心臓',knot:'結び目',shell:'貝殻',cone:'円錐',pyramid:'ピラミッド',rock:'岩',cloud:'雲',mushroom:'きのこ'};
for (const [value, text] of Object.entries(labels)) $('shape').append(new Option(text, value));
$('shape').append(new Option('じょうろ（生成済み）', 'generated-can'));
const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
const context = canvas.getContext('2d')!; context.font = '94px monospace'; context.textAlign='center'; context.textBaseline='middle';context.fillStyle='#eee';context.fillText('@',64,67);
const seedTexture = new THREE.CanvasTexture(canvas);
const seed = new THREE.Mesh(new THREE.PlaneGeometry(.55,.55),new THREE.MeshBasicMaterial({map:seedTexture,transparent:true,side:THREE.DoubleSide,depthTest:false}));
seed.quaternion.copy(scene.camera.quaternion); scene.world.add(seed);
let awakened = false, opened = false, composing = false, compositionEnd = -Infinity, wakeAt = -100;
let last = performance.now(), frameTimes: number[] = [], frames = 0;
const intake: {sprite:THREE.Sprite;from:THREE.Vector3;at:number;phase:number;duration:number}[]=[];
function openInput() { $('entry').hidden=false; $('panel').hidden=$('help').hidden=true; $('start').hidden=true; $('text').focus();opened=true; }
function closePanels() { $('entry').hidden=$('panel').hidden=$('help').hidden=true; if(!awakened) $('start').hidden=false; }
function animateIntake(text:string, color:string) {
  const input=$<HTMLInputElement>('text'), rect=input.getBoundingClientRect();
  const style=getComputedStyle(input), fontSize=Number.parseFloat(style.fontSize), measure=document.createElement('canvas').getContext('2d')!;measure.font=style.font;
  let prefix='';
  const positions=Array.from(new Intl.Segmenter('ja',{granularity:'grapheme'}).segment(text.normalize('NFC')),item=>{
    const char=item.segment, x=rect.left+Number.parseFloat(style.paddingLeft||'0')+measure.measureText(prefix).width+measure.measureText(char).width/2-input.scrollLeft;
    prefix+=char;return {char,x};
  }).filter(item=>!/^\s+$/u.test(item.char)&&item.x>=rect.left&&item.x<=rect.right).slice(-96);
  const direction=new THREE.Vector3(), origin=new THREE.Vector3();
  positions.forEach(({char,x},i)=>{
    const tile=document.createElement('canvas');tile.width=tile.height=96;const c=tile.getContext('2d')!;c.font='64px "Hiragino Kaku Gothic ProN","Yu Gothic",monospace';c.textAlign='center';c.textBaseline='middle';c.fillStyle='#fff';c.fillText(char,48,49,83);
    const material=new THREE.SpriteMaterial({map:new THREE.CanvasTexture(tile),color,transparent:true,depthTest:false,depthWrite:false});
    const sprite=new THREE.Sprite(material);sprite.renderOrder=10;
    const y=rect.top+rect.height*.5;
    origin.set(x/innerWidth*2-1,1-y/innerHeight*2,.5).unproject(scene.camera);direction.copy(origin).sub(scene.camera.position).normalize();
    const distance=scene.camera.position.length();origin.copy(scene.camera.position).addScaledVector(direction,distance);
    sprite.position.copy(origin);sprite.scale.setScalar(fontSize*1.5*distance*2*Math.tan(THREE.MathUtils.degToRad(scene.camera.fov/2))/innerHeight);
    scene.world.add(sprite);intake.push({sprite,from:origin.clone(),at:scene.time,phase:i*2.399963229728653+scene.time*.3,duration:2.7+(i%9)*.12});
  });
}
function fitCloser(){ scene.fitToView(); }
new ResizeObserver(()=>{if(awakened)fitCloser();}).observe($('scene'));
function wake(){
  if(!awakened){awakened=true;wakeAt=scene.time;scene.group.visible=true;$('actions').hidden=false;}
  $('start').hidden=true;$<HTMLSelectElement>('shape').value=scene.loaded?'generated-can':scene.spec.object;
}
function feed(text:string){
  if(!text.trim())return false;
  const count=graphemes(text).length;
  if(Array.from(text).length>4000){$('message').textContent='一度の入力が長すぎます。分けて送ってください。';return false;}
  if(count>MAX_LETTERS-scene.field.letters.length){$('message').textContent=`あと${MAX_LETTERS-scene.field.letters.length}字まで追加できます。`;return false;}
  try{
    const parsed=localInterpret(text,scene.spec);
    animateIntake(text,parsed.ink??'#ff5656');
    scene.field.add(text,scene.time,parsed.ink);
    const formChanged=(Object.keys(scene.spec) as (keyof FormSpec)[]).some(key=>scene.spec[key]!==parsed.spec[key]);
    if(parsed.source!=='unchanged'&&(formChanged||(scene.loaded&&parsed.objectSelected))){
      if(scene.loaded && parsed.objectSelected===false) scene.setImportedAttributes(parsed.spec); else scene.setForm(parsed.spec);
      fitCloser();
    }
    wake();scene.paused=false;$('pause').textContent='Ⅱ';
    $('message').textContent='';$('entry').hidden=true;$<HTMLInputElement>('text').value='';return true;
  }catch(error){$('message').textContent=error instanceof Error?error.message:String(error);return false;}
}
$('form').addEventListener('submit',event=>{event.preventDefault();if(!composing&&performance.now()-compositionEnd>80)feed($<HTMLInputElement>('text').value);});
$('text').addEventListener('input',()=>{const text=$<HTMLInputElement>('text').value;try{$('text').style.color=localInterpret(text,scene.spec).ink??'#ff7777';}catch{$('text').style.color='#eee';}});
$('text').addEventListener('compositionstart',()=>{composing=true;});
$('text').addEventListener('compositionend',()=>{composing=false;compositionEnd=performance.now();});
document.addEventListener('keydown',event=>{
  if(event.isComposing||composing||event.keyCode===229||performance.now()-compositionEnd<80)return;
  if(event.key==='Escape'){closePanels();return;}
  if(event.target instanceof Element&&event.target.closest('input,textarea,select,button,[contenteditable="true"]'))return;
  if(event.key==='Enter'&&!event.repeat){event.preventDefault();openInput();}
  if(event.key==='?'){event.preventDefault();$('help').hidden=!$('help').hidden;}
});
$('input-open').onclick=openInput;$('shape-open').onclick=()=>{$('panel').hidden=!$('panel').hidden;$('help').hidden=$('entry').hidden=true;};
$('help-open').onclick=()=>{$('help').hidden=!$('help').hidden;$('panel').hidden=$('entry').hidden=true;};
$('close-panel').onclick=()=>{$('panel').hidden=true;};$('close-help').onclick=()=>{$('help').hidden=true;};
$('pause').onclick=()=>{scene.paused=!scene.paused;$('pause').textContent=scene.paused?'▶':'Ⅱ';};
$('shape').onchange=async()=>{
  const shape=$<HTMLSelectElement>('shape').value;
  try {
    if(shape==='generated-can'){if(!await scene.loadGLB('/end-to-end-models/paired-v1/watering-can-image-triposr.glb'))return;}
    else scene.setForm({...DEFAULT_FORM,object:shape as ObjectId});
    fitCloser();wake();
  }catch(error){$('message').textContent=String(error);$('entry').hidden=false;}
};
$('view').onchange=()=>{scene.setRenderMode($<HTMLSelectElement>('view').value as 'presence'|'texture'|'advection');};
$('size').oninput=()=>{scene.material.uniforms.density.value=15/Number($<HTMLInputElement>('size').value);};
$('motion').oninput=()=>{scene.material.uniforms.bodyMotion.value=Number($<HTMLInputElement>('motion').value);};
$('speed').oninput=()=>{scene.material.uniforms.flow.value=Number($<HTMLInputElement>('speed').value);};
for(const text of ['白い球体を流れる','青い花瓶','四角くねじれた','赤い剣','花が咲いた','円環を3個']){const b=document.createElement('button');b.textContent=text;b.onclick=()=>{openInput();$<HTMLInputElement>('text').value=text;};$('examples').append(b);}
let down:{x:number;y:number}|undefined;
scene.renderer.domElement.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY};});
scene.renderer.domElement.addEventListener('pointerup',e=>{if(e.pointerType==='touch'&&down&&Math.hypot(down.x-e.clientX,down.y-e.clientY)<7)openInput();down=undefined;});
function render(dt:number){
  const t=scene.time;
  if(!awakened){seed.quaternion.copy(scene.camera.quaternion);seed.rotateY(.45*Math.sin(t*.45));seed.rotateZ(.07*Math.sin(t*.29));seed.position.set(.02*Math.sin(t*.7),.026*Math.cos(t*.6),0);}
  else{
    const age=t-wakeAt, scale=THREE.MathUtils.smoothstep(age,0,3.5);
    seed.visible=age<2;(seed.material as THREE.MeshBasicMaterial).opacity=Math.max(0,1-age/2);
    scene.group.scale.setScalar(.13+.87*scale);
  }
  for(let i=intake.length-1;i>=0;i--){const item=intake[i],p=Math.min(1,(t-item.at)/item.duration),e=p*p*(3-2*p),r=.8*Math.sin(Math.PI*p)*(1-p*.5),angle=item.phase+p*Math.PI*4;
    item.sprite.position.copy(item.from).multiplyScalar(1-e).add(new THREE.Vector3(r*Math.cos(angle),r*Math.sin(angle),Math.sin(angle*.7)*r));
    item.sprite.material.rotation=.18*Math.sin(angle);item.sprite.material.opacity=Math.min(1,(1-p)*5);
    if(p>=1){scene.world.remove(item.sprite);item.sprite.material.map?.dispose();item.sprite.material.dispose();intake.splice(i,1);}
  }
  scene.render(dt);
}
function frame(now:number){const elapsed=Math.max(0,(now-last)/1000);last=now;render(document.hidden?0:Math.min(.045,elapsed));if(!scene.paused&&!document.hidden){frameTimes.push(elapsed*1000);if(frameTimes.length>600)frameTimes.shift();}frames++;requestAnimationFrame(frame);}
requestAnimationFrame(frame);
if(import.meta.env.DEV) Object.assign(window,{__PRESENCE__:{
  inspect:()=>({...scene.inspect(),presence:scene.inspectPresence(),awakened,opened,intake:intake.length,frames,frameTimes:[...frameTimes]}),
  pause:(value=true)=>{scene.paused=value;},
  step:(seconds:number)=>{scene.paused=false;for(let n=0;n<Math.ceil(seconds*60);n++)render(seconds/Math.ceil(seconds*60));scene.paused=true;return scene.inspectPresence();},
  choose:(object:ObjectId)=>{scene.setForm({...DEFAULT_FORM,object});fitCloser();wake();},
  mode:(mode:'presence'|'texture'|'advection')=>scene.setRenderMode(mode),
}});

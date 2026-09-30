import './style.css';
import { SurfaceScene } from './scene';
import { DEFAULT_FORM, type FormSpec, type Interpretation } from './types';
import { localInterpret } from './local-interpret';
import { validateComposition } from './composition';
import { MAX_LETTERS, graphemes } from './letters';
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const examples = ['剣', '細長い花瓶', '四角い', 'ねじれた剣', '森の中で木陰に腰を下ろす', '花を一輪生ける器', '波打つ貝殻', '空を飛ぶ鳥', '赤い立方体', '球体を4個'];
$('#app').innerHTML = `<main id="scene" aria-label="ことばの面"></main><div id="start"><span>press enter</span></div><div id="badge"></div><p id="notice" hidden></p>
<section id="entry" hidden><form id="form"><div id="input-row"><label for="text">&gt;</label><input id="text" aria-label="加える文章" autocomplete="off" spellcheck="false" placeholder="文章を入力"><button>↵</button></div></form><p id="status" role="status"></p></section>
<nav id="actions" aria-label="操作"><button id="input-open">入力</button><button id="compare-open">比較</button><button id="pause">止める</button><button id="save-image">画像</button></nav>
<section id="panel" hidden aria-label="比較と操作"><p>形とことば</p><label>解釈<select id="method"><option value="semantic">意味から選ぶ</option><option value="rules">明示した語だけ</option><option value="compose">部品から作る・実験</option><option value="generate-ja">文章から立体生成・実験</option><option value="generate">英語から直接生成・実験</option></select></label><p id="model-state">ローカルモデルを確認中</p><p id="method-note"></p><label>文字の動かし方<select id="render-mode"><option value="texture">面を覆う</option><option value="advection">面を歩く・実験</option></select></label><p id="render-note"></p><label>文字の密度<input id="density" type="range" min="5" max="35" value="15"></label><label>流れ<input id="flow" type="range" min="0" max="1.8" step=".1" value="1"></label><label><input id="rotation" type="checkbox" checked> ゆっくり回転</label><div class="examples">${examples.map(e => `<button data-example="${e}">${e}</button>`).join('')}</div><p>文章はこの端末内で解釈します。色は追加する文字だけに付きます。ドラッグで回転、スクロールで距離。</p><label>生成・復元した形<select id="generated"><option value="">準備中</option></select></label><button id="load-generated" disabled>形を読み込む</button><label>既存の素材<select id="asset"><option value="tree_oak">木</option><option value="mushroom_red">きのこ</option><option value="flower_purpleA">花</option></select></label><button id="load-asset">素材を読み込む</button><p id="details"></p><button id="close-panel">閉じる</button></section>`;
let scene: SurfaceScene;
try { scene = new SurfaceScene($('#scene')); } catch(e) { $('#status').textContent = `描画を開始できません: ${String(e)}`; $('#entry').hidden = false; throw e; }
let busy = false, composing = false, ended = -Infinity, apiAvailable = false, last: Interpretation | undefined;
let time = performance.now(), awakened = false;
let sceneRevision=0;
function openInput() { $('#entry').hidden = false; $('#start').hidden = true; $('#text').focus(); }
function update() { $('#badge').textContent = awakened ? `${scene.field.letters.length}字` : ''; $('#pause').textContent = scene.paused ? '動かす' : '止める'; }
function details() {
  $('#details').textContent = last ? `${last.source}\n${last.candidates.map(c => `${c.object} ${c.score.toFixed(3)}`).join('\n')}\n${Math.round(last.elapsedMs)} ms\n${last.note ?? ''}` : '';
}
function validSpec(value: unknown): value is FormSpec {
  if (!value || typeof value !== 'object') return false;
  const s = value as FormSpec;
  return typeof s.object === 'string' && ['sphere','cube','vase','sword','tree','flower','fish','bird','chair','table','mug','bottle','house','tower','ring','star','heart','knot','shell','cone','pyramid','rock','cloud','mushroom'].includes(s.object)
    && [['squareness',0,1],['elongation',.5,2.5],['twist',-1,1],['bend',-1,1],['roughness',0,1],['count',1,8]].every(([k,min,max]) => typeof s[k as keyof FormSpec] === 'number' && Number.isFinite(s[k as keyof FormSpec]) && Number(s[k as keyof FormSpec]) >= Number(min) && Number(s[k as keyof FormSpec]) <= Number(max)) && Number.isInteger(s.count);
}
async function feed(text: string) {
  if (busy || !text.trim()) return;
  if (text.length > 4000) { $('#status').textContent = '一度に4,000文字までです。入力は残っています。'; return; }
  const remaining=MAX_LETTERS-scene.field.letters.length;
  if (graphemes(text).length > remaining) { $('#status').textContent = `あと${remaining}字まで追加できます。入力は残っています。`; return; }
  busy = true; ($('#text') as HTMLInputElement).disabled = true; $('#status').textContent = '…';
  const began = performance.now();
  const revision=++sceneRevision; scene.invalidateLoads();
  const ensureCurrent=()=>{if(revision!==sceneRevision) throw new Error('別の形を選んだため、この形の変更は取り消しました。');};
  try {
    let result: Interpretation;
    const method = ($('#method') as HTMLSelectElement).value;
    if (method === 'generate' || method === 'generate-ja') {
      let description=text;
      if(method==='generate-ja') {
        if(text.length>2000)throw new Error('立体の説明は一度に2,000文字までです。');
        $('#status').textContent='文章から形の説明を作っています…';
        const described=await fetch('/compose-api/describe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text}),signal:AbortSignal.timeout(60000)});
        if(!described.ok)throw new Error(described.status===422?'物体を特定できませんでした。形や物の説明を加えてください。':'形の説明を作れませんでした。');
        const data=await described.json();ensureCurrent();
        if(typeof data.text_en!=='string' || !data.text_en.trim() || data.text_en.length>300)throw new Error('物体を特定できませんでした。形や物の説明を加えてください。');
        description=data.text_en;
      }
      $('#status').textContent = '立体を生成しています… 約1分';
      const response=await fetch('/generate-api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:description}),signal:AbortSignal.timeout(240000)});
      if (!response.ok) { const err=await response.json().catch(()=>({})); throw new Error(err.error??'立体を生成できませんでした。'); }
      const blob=await response.blob();ensureCurrent();
      const url=URL.createObjectURL(blob);
      try { if(!await scene.loadGLB(url)) throw new Error('新しい形の選択に切り替わりました。'); }
      finally { URL.revokeObjectURL(url); }
      result={spec:{...scene.spec},source:'composed',candidates:[],ink:localInterpret(text,scene.spec).ink,elapsedMs:Number(response.headers.get('X-Generation-Ms'))||performance.now()-began,note:`Shap-E · ${description}`};
    } else if (method === 'compose') {
      if (text.length > 2000) throw new Error('部品の生成は一度に2,000文字までです。');
      $('#status').textContent = '形を作っています…';
      const response=await fetch('/compose-api/compose',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text}),signal:AbortSignal.timeout(180000)});
      if (!response.ok) throw new Error(response.status === 503 ? '別の形を生成中です。少し待ってから送信してください。' : '形を作れませんでした。');
      const data=validateComposition(await response.json());
      ensureCurrent();
      scene.setComposition(data);
      result={spec:{...scene.spec},source:'composed',candidates:[],ink:localInterpret(text,scene.spec).ink,elapsedMs:data.elapsedMs??performance.now()-began,note:`${data.model??'Local composition'} · ${data.label}`};
    } else if (apiAvailable) {
      const response = await fetch('/api/interpret', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ text, previous:scene.spec, mode:method }), signal:AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('意味の解釈に失敗しました。');
      result = await response.json();
      if (!validSpec(result.spec)) throw new Error('形の指定を確認できませんでした。');
    } else result = localInterpret(text, scene.spec);
    ensureCurrent(); last = result;
    scene.field.add(text, scene.time, result.ink);
    if (!['compose','generate','generate-ja'].includes(method) && result.source !== 'unchanged') {
      if (scene.loaded && result.objectSelected === false) scene.setImportedAttributes(result.spec);
      else scene.setForm(result.spec);
    }
    scene.paused = false; awakened = true; update(); details();
    $('#text').setAttribute('value',''); ($('#text') as HTMLInputElement).value = '';
    $('#status').textContent = result.source === 'unchanged' ? '文字を追加。形はそのまま。' : `${result.spec.object} · ${Math.round(performance.now() - began)} ms`;
    $('#entry').hidden = true;
  } catch(error) { $('#status').textContent = `${error instanceof Error ? error.message : error} 入力は残っています。`; }
  finally { busy = false; ($('#text') as HTMLInputElement).disabled = false; if (!$('#entry').hidden) $('#text').focus(); }
}
$('#form').addEventListener('submit', event => { event.preventDefault(); if (!composing && performance.now() - ended > 80) void feed(($('#text') as HTMLInputElement).value); });
$('#text').addEventListener('compositionstart', () => { composing = true; });
$('#text').addEventListener('compositionend', () => { composing = false; ended = performance.now(); });
document.addEventListener('keydown', event => {
  if (event.isComposing || composing || event.keyCode === 229 || performance.now() - ended < 80) return;
  if (event.key === 'Escape') { $('#entry').hidden = true; $('#panel').hidden = true; }
  const control=event.target instanceof Element && event.target.closest('input,textarea,select,button,[contenteditable="true"]');
  if(control)return;
  if (event.key === 'Enter' && !event.repeat) { event.preventDefault(); openInput(); }
  if (event.key === '?') $('#panel').hidden = !$('#panel').hidden;
});
$('#method').onchange=()=>{
  const mode=($('#method') as HTMLSelectElement).value;
  $('#method-note').textContent = mode==='generate-ja' ? '文章から物体の説明を作り、立体を生成します。約1分。' : mode==='generate' ? '英語の短い物体説明。約1分。形の精度には限界があります。' : mode==='compose' ? '文章から部品を組みます。数秒。位置や数を間違えることがあります。' : '24種の形から選び、四角さやねじれを変えます。';
};
$('#input-open').onclick = openInput;
$('#compare-open').onclick = () => { $('#panel').hidden = !$('#panel').hidden; };
$('#close-panel').onclick = () => { $('#panel').hidden = true; };
$('#pause').onclick = () => { scene.paused = !scene.paused; update(); };
$('#density').oninput = () => { scene.material.uniforms.density.value = Number(($('#density') as HTMLInputElement).value); };
$('#render-mode').onchange=()=>{ const mode=($('#render-mode') as HTMLSelectElement).value==='advection'?'advection':'texture';scene.setRenderMode(mode);$('#render-note').textContent=mode==='advection'?'文字ごとに面をたどります。細かな曲面では一部が隠れます。':''; };
$('#flow').oninput = () => { scene.material.uniforms.flow.value = Number(($('#flow') as HTMLInputElement).value); };
$('#rotation').onchange = () => { scene.controls.autoRotate = ($('#rotation') as HTMLInputElement).checked; };
document.querySelectorAll<HTMLButtonElement>('[data-example]').forEach(button => { button.onclick = () => { if(busy)return; openInput(); ($('#text') as HTMLInputElement).value = button.dataset.example!; $('#panel').hidden = true; }; });
$('#save-image').onclick = () => { scene.render(0); const a = document.createElement('a'); a.download = 'semantic-glyph.png'; a.href = scene.renderer.domElement.toDataURL('image/png'); a.click(); };
async function health() {
  try { const r = await fetch('/api/health', { signal:AbortSignal.timeout(4000) }); const info = await r.json(); apiAvailable = r.ok && info.semanticReady === true; $('#model-state').textContent = apiAvailable ? '意味モデル: 端末内' : '明示語のみ'; }
  catch { apiAvailable = false; $('#model-state').textContent = '意味モデルは未起動。明示語の基準で動作中。'; }
}
void health(); setInterval(health, 15000);
async function generated() {
  const select = $('#generated') as HTMLSelectElement; select.replaceChildren();
  for (const folder of ['generated','reconstructed','text-image-models']) {
    try {
      const response=await fetch(`/${folder}/manifest.json`);if(!response.ok)continue;
      const manifest=await response.json(), models=Array.isArray(manifest)?manifest:manifest.models;
      if(!Array.isArray(models))continue;
      const group=document.createElement('optgroup');group.label=folder==='generated'?'文章から直接生成':folder==='reconstructed'?'画像から復元':'文章→画像→立体';
      for(const m of models) {
        if(typeof m.path!=='string')continue;
        const option=document.createElement('option');option.textContent=m.label??m.prompt??m.id;
        option.value=m.path.startsWith('/')?m.path:`/${folder}/${m.path}`;group.append(option);
      }
      select.append(group);
    } catch { /* This optional experiment may not have generated artifacts yet. */ }
  }
  ($('#load-generated') as HTMLButtonElement).disabled=select.options.length===0;
}
$('#load-generated').onclick = async () => {
  const path = ($('#generated') as HTMLSelectElement).value;
  if (!/^\/(?:generated|reconstructed|text-image-models)\/[\w.\-/]+\.glb$/.test(path) || path.includes('..')) return;
  sceneRevision++;
  $('#model-state').textContent = '形を読み込み中';
  try { if (await scene.loadGLB(path)) { awakened = true; update(); $('#panel').hidden = true; } }
  catch(e) { $('#model-state').textContent = String(e); }
};
$('#load-asset').onclick = async () => {
  const name = ($('#asset') as HTMLSelectElement).value;
  if (!['tree_oak','mushroom_red','flower_purpleA'].includes(name)) return;
  sceneRevision++;
  try { if (await scene.loadOBJ(`/models/kenney/${name}.obj`)) { awakened = true; update(); $('#panel').hidden = true; } }
  catch(e) { $('#model-state').textContent = String(e); }
};
void generated();
function frame(now: number) { const dt = Math.min(.06, (now - time)/1000); time = now; scene.render(document.hidden ? 0 : dt); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
if (import.meta.env.DEV) Object.assign(window,{__SEMANTIC_GLYPH__:{inspect:()=>({...scene.inspect(),apiAvailable,last,busy}),pause:(v=true)=>{scene.paused=v;},step:(seconds:number)=>{scene.paused=false;scene.render(seconds);scene.paused=true;}, setForm:(spec:FormSpec)=>scene.setForm(spec),defaultForm:DEFAULT_FORM}});

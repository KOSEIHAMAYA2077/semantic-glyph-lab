import './style.css';
import { SurfaceScene } from './scene';
import { DEFAULT_FORM, type FormSpec, type Interpretation } from './types';
import { localInterpret } from './local-interpret';
import { MAX_LETTERS } from './letters';
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const examples = ['剣', '細長い花瓶', '四角い', 'ねじれた剣', '森の中で木陰に腰を下ろす', '花を一輪生ける器', '波打つ貝殻', '空を飛ぶ鳥', '赤い立方体', '球体を4個'];
$('#app').innerHTML = `<main id="scene" aria-label="ことばの面"></main><div id="start"><span>press enter</span></div><div id="badge"></div><p id="notice" hidden></p>
<section id="entry" hidden><form id="form"><div id="input-row"><label for="text">&gt;</label><input id="text" aria-label="加える文章" autocomplete="off" spellcheck="false" placeholder="文章を入力"><button>↵</button></div></form><p id="status" role="status"></p></section>
<nav id="actions" aria-label="操作"><button id="input-open">入力</button><button id="compare-open">比較</button><button id="pause">止める</button><button id="save-image">画像</button></nav>
<section id="panel" hidden aria-label="比較と操作"><p>形とことば</p><label>解釈<select id="method"><option value="semantic">意味から選ぶ</option><option value="rules">明示した語だけ</option></select></label><p id="model-state">ローカルモデルを確認中</p><label>文字の密度<input id="density" type="range" min="5" max="35" value="15"></label><label>流れ<input id="flow" type="range" min="0" max="1.8" step=".1" value="1"></label><label><input id="rotation" type="checkbox" checked> ゆっくり回転</label><div class="examples">${examples.map(e => `<button data-example="${e}">${e}</button>`).join('')}</div><p>文章はこの端末内で解釈します。色は追加する文字だけに付きます。ドラッグで回転、スクロールで距離。</p><label>生成した形<select id="generated"><option value="">準備中</option></select></label><button id="load-generated" disabled>形を読み込む</button><label>既存の素材<select id="asset"><option value="tree_oak">木</option><option value="mushroom_red">きのこ</option><option value="flower_purpleA">花</option></select></label><button id="load-asset">素材を読み込む</button><p id="details"></p><button id="close-panel">閉じる</button></section>`;
let scene: SurfaceScene;
try { scene = new SurfaceScene($('#scene')); } catch(e) { $('#status').textContent = `描画を開始できません: ${String(e)}`; $('#entry').hidden = false; throw e; }
let busy = false, composing = false, ended = -Infinity, apiAvailable = false, last: Interpretation | undefined;
let time = performance.now(), awakened = false;
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
  if (busy || !text.trim() || text.length > 4000) return;
  if (scene.field.letters.length >= MAX_LETTERS) { $('#status').textContent = 'この試作は4,096字までです。'; return; }
  busy = true; ($('#text') as HTMLInputElement).disabled = true; $('#status').textContent = '…';
  const began = performance.now();
  try {
    let result: Interpretation;
    const method = $('#method') as HTMLSelectElement;
    if (apiAvailable) {
      const response = await fetch('/api/interpret', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ text, previous:scene.spec, mode:method.value }), signal:AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('意味の解釈に失敗しました。');
      result = await response.json();
      if (!validSpec(result.spec)) throw new Error('形の指定を確認できませんでした。');
    } else result = localInterpret(text, scene.spec);
    last = result;
    scene.field.add(text, scene.time, result.ink);
    if (result.source !== 'unchanged') scene.setForm(result.spec);
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
  if (event.key === 'Enter' && event.target !== $('#text') && !event.repeat) { event.preventDefault(); openInput(); }
  if (event.key === '?' && event.target !== $('#text')) $('#panel').hidden = !$('#panel').hidden;
});
$('#input-open').onclick = openInput;
$('#compare-open').onclick = () => { $('#panel').hidden = !$('#panel').hidden; };
$('#close-panel').onclick = () => { $('#panel').hidden = true; };
$('#pause').onclick = () => { scene.paused = !scene.paused; update(); };
$('#density').oninput = () => { scene.material.uniforms.density.value = Number(($('#density') as HTMLInputElement).value); };
$('#flow').oninput = () => { scene.material.uniforms.flow.value = Number(($('#flow') as HTMLInputElement).value); };
$('#rotation').onchange = () => { scene.controls.autoRotate = ($('#rotation') as HTMLInputElement).checked; };
document.querySelectorAll<HTMLButtonElement>('[data-example]').forEach(button => { button.onclick = () => { openInput(); ($('#text') as HTMLInputElement).value = button.dataset.example!; $('#panel').hidden = true; }; });
$('#save-image').onclick = () => { scene.render(0); const a = document.createElement('a'); a.download = 'semantic-glyph.png'; a.href = scene.renderer.domElement.toDataURL('image/png'); a.click(); };
async function health() {
  try { const r = await fetch('/api/health', { signal:AbortSignal.timeout(4000) }); const info = await r.json(); apiAvailable = r.ok && info.semanticReady === true; $('#model-state').textContent = apiAvailable ? '意味モデル: 端末内' : '明示語のみ'; }
  catch { apiAvailable = false; $('#model-state').textContent = '意味モデルは未起動。明示語の基準で動作中。'; }
}
void health(); setInterval(health, 15000);
async function generated() {
  try {
    const r = await fetch('/generated/manifest.json'); if (!r.ok) return;
    const manifest = await r.json(); const models = Array.isArray(manifest) ? manifest : manifest.models;
    if (!Array.isArray(models)) return;
    const select = $('#generated') as HTMLSelectElement; select.replaceChildren();
    for (const m of models) { const option = document.createElement('option'); option.textContent = m.label ?? m.prompt ?? m.id; option.value = m.path.startsWith('/') ? m.path : `/generated/${m.path}`; select.append(option); }
    $('#load-generated').removeAttribute('disabled');
  } catch { /* No generated models yet. */ }
}
$('#load-generated').onclick = async () => {
  const path = ($('#generated') as HTMLSelectElement).value;
  if (!/^\/generated\/[\w.\-/]+\.glb$/.test(path) || path.includes('..')) return;
  $('#model-state').textContent = '形を読み込み中';
  try { if (await scene.loadGLB(path)) { awakened = true; update(); $('#panel').hidden = true; } }
  catch(e) { $('#model-state').textContent = String(e); }
};
$('#load-asset').onclick = async () => {
  const name = ($('#asset') as HTMLSelectElement).value;
  if (!['tree_oak','mushroom_red','flower_purpleA'].includes(name)) return;
  try { if (await scene.loadOBJ(`/models/kenney/${name}.obj`)) { awakened = true; update(); $('#panel').hidden = true; } }
  catch(e) { $('#model-state').textContent = String(e); }
};
void generated();
function frame(now: number) { const dt = Math.min(.06, (now - time)/1000); time = now; scene.render(document.hidden ? 0 : dt); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
if (import.meta.env.DEV) Object.assign(window,{__SEMANTIC_GLYPH__:{inspect:()=>({...scene.inspect(),apiAvailable,last,busy}),pause:(v=true)=>{scene.paused=v;},step:(seconds:number)=>{scene.paused=false;scene.render(seconds);scene.paused=true;}, setForm:(spec:FormSpec)=>scene.setForm(spec),defaultForm:DEFAULT_FORM}});

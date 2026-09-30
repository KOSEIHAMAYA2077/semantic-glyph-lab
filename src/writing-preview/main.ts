import './style.css';
import { ContinuousInput, type ContinuousState } from '../continuous';
import { attributesOf, contextFor, specFor, validateIntent, type Attributes, type ShapeContext } from '../intent';
import { graphemes, MAX_LETTERS } from '../letters';
import { localAttributeEdit, localInterpret } from '../local-interpret';
import { SurfaceScene } from '../scene';

type Mode = 'new' | 'edit' | 'keep';
const modeNames: Record<Mode, string> = { new:'文章から形を作る', edit:'今の形を変える', keep:'文字だけ加える' };
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLTextAreaElement>('text'), mode = $<HTMLSelectElement>('mode');
const scene = new SurfaceScene($('stage'));
let displayed = contextFor(scene.spec);
const modes = new Map<number, Mode>();
let submittingMode: Mode = 'keep', inputError = '', composing = false, compositionEnded = -Infinity;
const audit = { accepted:0, installed:0, urlsCreated:0, urlsRevoked:0, routes:[] as { id:number; mode:Mode }[] };

function displayState(state: ContinuousState) {
  const phases = { idle:'', interpreting:'形を確認中', generating:'生成中', installing:'読込中' };
  $('state').textContent = [phases[state.phase], state.pending ? `待機 ${state.pending} / 8` : ''].filter(Boolean).join(' / ') || 'Enter：送信';
  $('count').textContent = `${Array.from(input.value).length} / 2000　${scene.field.letters.length} / ${MAX_LETTERS}`;
  const error = inputError || state.error;
  $('error').textContent = error; $('error').hidden = !error;
  $('retry').hidden = !state.canRetry;
  $('retry').textContent = state.canRetryGeneration ? '入力の処理を再試行' : '再試行';
  $<HTMLButtonElement>('retry').disabled = state.pending >= 8;
  $('retry-generation').hidden = !state.canRetryGeneration;
  $<HTMLButtonElement>('retry-generation').disabled = state.pending >= 8;
  $('history-count').textContent = String(scheduler.accepted.length);
  const states = { queued:'待機', interpreting:'処理中', applied:'受理', failed:'確認待ち', cancelled:'取消' };
  $('entries').replaceChildren(...scheduler.accepted.map(entry => {
    const li = document.createElement('li'), label = document.createElement('small'), raw = document.createElement('pre');
    label.textContent = `${modeNames[modes.get(entry.id)!]} / ${states[entry.state]}`;
    raw.textContent = entry.raw; li.append(label, raw); return li;
  }));
}

async function describe(text: string) {
  const response = await fetch('/description-api/describe', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text}), signal:AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(response.status === 422 ? '物体を特定できませんでした。原文を残しています。' : '形の説明を作れませんでした。再試行できます。');
  const data: unknown = await response.json();
  const text_en = data && typeof data === 'object' && 'text_en' in data ? data.text_en : undefined;
  return validateIntent({ action:'new', target:{form:null, object_en:text_en}, changes:{} });
}

const scheduler = new ContinuousInput<Blob>(displayed, {
  accepted(entry) {
    // Validate before either raw history or the glyph field mutates. Never
    // truncate a submitted paragraph silently at the atlas boundary.
    if (Array.from(entry.raw).length > 2000) throw new Error('一度の入力は2000文字までです。入力欄に全文を残しています。');
    if (scene.field.letters.length + graphemes(entry.raw).length > MAX_LETTERS) throw new Error('文字の上限は4096です。入力欄に全文を残しています。');
    const ink = localInterpret(entry.raw, scene.spec).ink;
    modes.set(entry.id, submittingMode);
    scene.field.add(entry.raw, scene.time, ink);
    audit.accepted++;
  },
  async route(raw, current, writing) {
    const selected = modes.get(writing.id);
    if (!selected) throw new Error('入力の操作を確認できませんでした。');
    audit.routes.push({id:writing.id, mode:selected});
    if (selected === 'keep') return { action:'keep', target:null, changes:{} };
    if (selected === 'new') return describe(raw);
    const before = specFor(current), interpreted = localAttributeEdit(raw, before);
    if (!interpreted) throw new Error('形の変更は「四角く」「ねじれた」「3個」などで指定してください。原文を残しています。');
    const changes: Partial<Attributes> = {};
    for (const [key, value] of Object.entries(attributesOf(interpreted.spec))) {
      if (value !== before[key as keyof Attributes]) changes[key as keyof Attributes] = value;
    }
    // A valid command already satisfied by the target is a no-op, not an error.
    return Object.keys(changes).length ? validateIntent({action:'edit',target:null,changes}) : {action:'keep',target:null,changes:{}};
  },
  async generate(description) {
    const response = await fetch('/image-api/generate', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text:description}), signal:AbortSignal.timeout(240_000) });
    if (!response.ok) throw new Error('立体を生成できませんでした。文字を残しています。再試行できます。');
    const blob = await response.blob();
    if (!blob.size || blob.size > 50 * 1024 * 1024) throw new Error('立体の容量を確認できませんでした。再試行できます。');
    return blob;
  },
  known(current) { scene.setForm(specFor(current)); displayed = structuredClone(current); },
  edit(current) {
    if (current.target.form) scene.setForm(specFor(current));
    else scene.setImportedAttributes(specFor(current));
    displayed = structuredClone(current);
  },
  async install(blob, current, isCurrent) {
    if (!isCurrent()) return false;
    const url = URL.createObjectURL(blob); audit.urlsCreated++;
    try {
      const installed = await scene.loadGLB(url);
      if (!installed || !isCurrent()) return false;
      scene.setImportedAttributes(specFor(current));
      displayed = structuredClone(current); audit.installed++;
      return true;
    } finally { URL.revokeObjectURL(url); audit.urlsRevoked++; }
  },
  invalidate() { scene.invalidateLoads(); },
  changed(state) { displayState(state); },
});

function submit() {
  if (composing || performance.now() - compositionEnded < 80) return;
  inputError = '';
  submittingMode = mode.value as Mode;
  try {
    const accepted = scheduler.submit(input.value);
    if (accepted) input.value = '';
    else if (input.value.trim()) inputError = '待機は8件までです。入力欄に全文を残しています。';
  } catch (error) { inputError = error instanceof Error ? error.message : String(error); }
  displayState(scheduler.state); input.focus();
}
$('terminal').addEventListener('submit', event => { event.preventDefault(); submit(); });
input.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) {
    if (!event.isComposing && !composing && event.keyCode !== 229) { event.preventDefault(); submit(); }
  }
});
input.addEventListener('compositionstart', () => { composing = true; });
input.addEventListener('compositionend', () => { composing = false; compositionEnded = performance.now(); });
input.addEventListener('input', () => { inputError = ''; displayState(scheduler.state); });
$('cancel').addEventListener('click', () => { inputError = ''; scheduler.reset(displayed); input.focus(); });
$('retry').addEventListener('click', () => { inputError = ''; scheduler.retry(); displayState(scheduler.state); input.focus(); });
$('retry-generation').addEventListener('click', () => { inputError = ''; scheduler.retryGeneration(); displayState(scheduler.state); input.focus(); });
$('pause').addEventListener('click', () => {
  scene.paused = !scene.paused; $('pause').textContent = scene.paused ? '再開' : '一時停止'; $('pause').setAttribute('aria-pressed', String(scene.paused));
});
$('help').addEventListener('click', () => { $('hint').hidden = !$('hint').hidden; $('help').setAttribute('aria-expanded', String(!$('hint').hidden)); });
let last = performance.now();
function frame(now: number) { scene.render(Math.min(.05, (now-last)/1000)); last=now; requestAnimationFrame(frame); }
requestAnimationFrame(frame); displayState(scheduler.state);

// Read-only observations for the separate browser experiment. No remote model
// or extra input path is hidden behind this hook.
Object.assign(window, { __writing: {
  inspect: () => ({ scene:scene.inspect(), current:scheduler.current, displayed:structuredClone(displayed), state:scheduler.state,
    accepted:scheduler.accepted.map(entry => ({...entry, mode:modes.get(entry.id)})), audit:structuredClone(audit) }),
  whenIdle: () => scheduler.whenIdle(),
} });

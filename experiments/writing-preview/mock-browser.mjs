import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(root, 'experiments/writing-preview', process.argv[2] || 'mock-v1');
await mkdir(output, { recursive:false });
const mesh = await readFile(path.join(root, 'public/end-to-end-models/paired-v1/watering-can-image-triposr.glb'));
const browser = await chromium.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true });
const results = { at:new Date().toISOString(), kind:'local browser mocks; no model inference', cases:[], errors:[] };
const deferred = () => { let resolve; const promise = new Promise(r=>resolve=r); return {promise,resolve}; };
const inspect = page => page.evaluate(()=>window.__writing.inspect());
const wait = async (page, predicate, description) => {
  const start=Date.now();
  while (Date.now()-start<12_000) { const state=await inspect(page); if(predicate(state)) return state; await page.waitForTimeout(25); }
  throw new Error(`Timed out: ${description}`);
};
const send = async (page, text, mode='keep') => {
  await page.locator('#mode').selectOption(mode); await page.locator('#text').fill(text); await page.locator('#text').press('Enter');
};
const idle = page => wait(page,s=>s.state.phase==='idle'&&s.state.pending===0,'idle');

async function run(name, body) {
  const started=Date.now(), page=await browser.newPage({ viewport:{width:1280,height:900},deviceScaleFactor:1 });
  const errors=[], network=[], descriptions=[], generations=[], expectedHttp=[], httpConsole=[];
  const handlers = {
    describe:async (route,text)=>route.fulfill({json:{text_en:'a watering can'}}),
    generate:async (route,text)=>route.fulfill({body:mesh,contentType:'model/gltf-binary'}),
  };
  page.on('pageerror', e=>errors.push(e.message));
  page.on('console', e=>{
    if(e.type()!=='error')return;
    const text=e.text(), location=e.location().url;
    const expected=expectedHttp.some(({status,path})=>text.startsWith(`Failed to load resource: the server responded with a status of ${status} `)&&location.endsWith(path));
    if(expected)httpConsole.push({text,location});else errors.push(text);
  });
  page.on('request', request=>{const url=request.url();if(/^https?:/.test(url)&&!url.startsWith('http://127.0.0.1:4183/'))network.push(url);});
  await page.route('**/description-api/describe', async route=>{const {text}=route.request().postDataJSON();descriptions.push(text);await handlers.describe(route,text);});
  await page.route('**/image-api/generate', async route=>{const {text}=route.request().postDataJSON();generations.push(text);await handlers.generate(route,text);});
  // No other inference or retrieval endpoint is permitted by this experiment.
  await page.route(/\/(?:api|compose-api|generate-api|retrieval-api)\//, route=>{errors.push(`Unexpected API ${route.request().url()}`);return route.abort();});
  try {
    await page.goto('http://127.0.0.1:4183/src/writing-preview/index.html');
    await page.waitForFunction(()=>Boolean(window.__writing));
    await body({page,handlers,descriptions,generations,expectedHttp});
    const state=await inspect(page);
    assert.equal(state.scene.gpuError,0); assert.deepEqual(errors,[]); assert.deepEqual(network,[]);
    results.cases.push({name,pass:true,ms:Date.now()-started,accepted:state.accepted.length,glyphs:state.scene.count,installed:state.audit.installed,urls:[state.audit.urlsCreated,state.audit.urlsRevoked],descriptions:descriptions.length,generations:generations.length,glError:state.scene.gpuError,expectedHttpConsole:httpConsole});
    console.log(`PASS ${name}`);
  } catch(error) {
    results.cases.push({name,pass:false,ms:Date.now()-started,error:String(error),errors,network});
    results.errors.push(name); console.log(`FAIL ${name}: ${error}`);
    await page.screenshot({path:path.join(output,`${results.cases.length}-failure.png`)});
  } finally { await page.close(); }
}

try {
  await run('immediate raw and color during generation; latest attributes before adoption', async ({page,handlers,descriptions,generations})=>{
    const gate=deferred(); handlers.generate=async route=>{await gate.promise;await route.fulfill({body:mesh,contentType:'model/gltf-binary'});};
    const raw=' 白いじょうろ\n\n';
    await send(page,raw,'new'); await wait(page,s=>s.state.phase==='generating','generation begins');
    await send(page,'赤い 文字だけ。','keep'); await send(page,'ねじれた','edit');
    let state=await inspect(page);
    assert.equal(state.accepted[0].raw,raw); assert.equal(state.accepted.length,3); assert.equal(state.audit.installed,0);
    assert.equal(state.current.target.object_en,'a watering can'); assert.equal(state.displayed.target.form,'sphere');
    assert.equal(state.scene.count,1+Array.from('白いじょうろ赤い文字だけ。ねじれた').length);
    assert(state.scene.letters.filter(l=>'赤い文字だけ。'.includes(l.text)&&l.at>=0).some(l=>l.ink==='#ef6969'));
    assert.equal(await page.locator('#text').isEnabled(),true);
    await page.screenshot({path:path.join(output,'waiting.png')});
    gate.resolve(); state=await idle(page);
    assert.equal(state.audit.installed,1); assert.equal(state.scene.spec.twist,.65);
    assert.equal(state.displayed.target.object_en,'a watering can'); assert.equal(state.current.target.form,null);
    assert.deepEqual(state.audit.routes.map(r=>r.mode),['new','keep','edit']); assert.deepEqual([descriptions.length,generations.length],[1,1]);
    assert.deepEqual([state.audit.urlsCreated,state.audit.urlsRevoked],[1,1]);
    await page.screenshot({path:path.join(output,'installed.png')});
  });

  await run('identical raw captures different submit modes and retains mode on retry', async ({page,handlers,descriptions,expectedHttp})=>{
    expectedHttp.push({status:422,path:'/description-api/describe'});
    let attempts=0; handlers.describe=async route=>{attempts++;await route.fulfill(attempts===1?{status:422,json:{error:'mock rejection'}}:{json:{text_en:'a cube'}});};
    await send(page,'四角く','keep'); await idle(page);
    await send(page,'四角く','new'); let state=await idle(page);
    assert.equal(state.state.canRetry,true); assert.equal(state.accepted[1].state,'failed'); const before=state.scene.count;
    await page.locator('#mode').selectOption('edit'); await page.locator('#retry').click(); state=await idle(page);
    assert.equal(state.scene.count,before); assert.equal(state.accepted.length,2);
    assert.deepEqual(state.audit.routes,[{id:1,mode:'keep'},{id:2,mode:'new'},{id:2,mode:'new'}]);
    assert.deepEqual(descriptions,['四角く','四角く']); assert.equal(state.displayed.target.object_en,'a cube');
  });

  await run('new target after delayed generation discards old mesh', async ({page,handlers,descriptions,generations})=>{
    const gate=deferred(); let calls=0;
    handlers.describe=async (route,text)=>route.fulfill({json:{text_en:text==='花瓶'?'a vase':'a small boat'}});
    handlers.generate=async route=>{if(++calls===1)await gate.promise;await route.fulfill({body:mesh,contentType:'model/gltf-binary'});};
    await send(page,'花瓶','new'); await wait(page,s=>s.state.phase==='generating','first generation');
    await send(page,'小舟','new'); await send(page,'３個','edit'); gate.resolve();
    const state=await idle(page);
    assert.equal(state.audit.installed,1); assert.equal(state.displayed.target.object_en,'a small boat'); assert.equal(state.scene.spec.count,3);
    assert.deepEqual(generations,['a vase','a small boat']); assert.equal(descriptions.length,2); assert.deepEqual([state.audit.urlsCreated,state.audit.urlsRevoked],[1,1]);
  });

  await run('generation failure retry keeps text once and applies later edit', async ({page,handlers,descriptions,generations,expectedHttp})=>{
    expectedHttp.push({status:503,path:'/image-api/generate'});
    let calls=0; handlers.generate=async route=>route.fulfill(++calls===1?{status:503,json:{error:'mock busy'}}:{body:mesh,contentType:'model/gltf-binary'});
    await send(page,'じょうろ','new'); let state=await idle(page);
    assert.equal(state.state.canRetry,true); assert.equal(state.audit.installed,0); const glyphs=state.scene.count;
    await send(page,'四角く','edit'); state=await idle(page);
    assert.equal(state.current.attributes.squareness,1); assert.equal(state.scene.spec.squareness,0);
    await page.locator('#mode').selectOption('keep'); await page.locator('#retry').click(); state=await idle(page);
    assert.equal(state.scene.count,glyphs+3); assert.equal(state.accepted.length,2); assert.equal(state.audit.installed,1); assert.equal(state.scene.spec.squareness,1);
    assert.deepEqual([descriptions.length,generations.length],[1,2]); assert.equal(state.state.error,'');
  });

  await run('strict edit rejection retains raw; prohibited and noun commands do not edit', async ({page,descriptions,generations})=>{
    for (const raw of ['四角くするな','長い注ぎ口のじょうろ']) {
      await send(page,raw,'edit'); const state=await idle(page); assert.equal(state.state.canRetry,true); assert.equal(state.scene.spec.squareness,0); assert.equal(state.scene.spec.elongation,1);
    }
    let state=await inspect(page); const glyphs=state.scene.count;
    await page.locator('#mode').selectOption('new'); await page.locator('#retry').click(); state=await idle(page);
    assert.equal(state.scene.count,glyphs); assert.equal(state.accepted.length,2); assert.equal(state.state.canRetry,true); assert.deepEqual(descriptions,[]); assert.deepEqual(generations,[]);
    assert.deepEqual(state.audit.routes.map(r=>r.mode),['edit','edit','edit']);
    await page.locator('#history').evaluate(el=>el.open=true);
    assert.equal(await page.locator('#entries pre').nth(0).textContent(),'四角くするな');
  });

  await run('IME composition Enter and 80ms trailing Enter do not send', async ({page})=>{
    await page.locator('#text').fill('文字');
    await page.locator('#text').evaluate(el=>{
      el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
      el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));
      el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));
      el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    });
    assert.equal((await inspect(page)).accepted.length,0);
    await page.waitForTimeout(100); await page.locator('#text').press('Enter'); let state=await idle(page); assert.equal(state.accepted.length,1);
    await page.locator('#text').fill('一行'); await page.locator('#text').press('Shift+Enter'); await page.locator('#text').press('End'); await page.locator('#text').type('二行');
    const raw=await page.locator('#text').inputValue(); assert(raw.includes('\n')); assert.equal((await inspect(page)).accepted.length,1);
    await page.locator('#text').press('Enter'); state=await idle(page); assert.equal(state.accepted[1].raw,raw);
  });

  await run('input 2000 and total 4096 are atomic; no truncation or lost draft', async ({page})=>{
    await send(page,'あ'.repeat(2001)); let state=await idle(page); assert.equal(state.scene.count,1); assert.equal(state.accepted.length,0); assert.equal((await page.locator('#text').inputValue()).length,2001);
    await send(page,'あ'.repeat(2000)); await idle(page); await send(page,'い'.repeat(2000)); await idle(page); await send(page,'う'.repeat(95)); state=await idle(page);
    assert.equal(state.scene.count,4096); assert.equal(state.accepted.length,3);
    await send(page,'え'); state=await idle(page); assert.equal(state.scene.count,4096); assert.equal(state.accepted.length,3); assert.equal(await page.locator('#text').inputValue(),'え');
    assert.match(await page.locator('#error').textContent(),/4096/);
  });

  await run('queue 8 keeps rejected draft; cancel retains visible identity and text', async ({page,handlers})=>{
    await send(page,'じょうろ','new'); let state=await idle(page); assert.equal(state.displayed.target.object_en,'a watering can');
    const gate=deferred(); handlers.describe=async route=>route.fulfill({json:{text_en:'a small boat'}}); handlers.generate=async route=>{await gate.promise;await route.fulfill({body:mesh,contentType:'model/gltf-binary'});};
    await send(page,'舟','new'); await wait(page,s=>s.state.phase==='generating','second generation');
    for(let n=0;n<8;n++)await send(page,`文${n}`,'keep');
    state=await inspect(page); const glyphs=state.scene.count; assert.equal(state.state.pending,8);
    await send(page,'まだ入力中','keep'); state=await inspect(page); assert.equal(state.scene.count,glyphs); assert.equal(state.accepted.length,10); assert.equal(await page.locator('#text').inputValue(),'まだ入力中');
    await page.locator('#cancel').click(); state=await inspect(page); assert.equal(state.state.pending,0); assert.equal(state.scene.count,glyphs); assert.equal(state.displayed.target.object_en,'a watering can'); assert.equal(state.current.target.object_en,'a watering can');
    assert.equal(state.accepted.filter(e=>e.state==='cancelled').length,8); assert.equal(await page.locator('#text').inputValue(),'まだ入力中');
    await send(page,'ねじれた','edit'); gate.resolve(); state=await idle(page);
    assert.equal(state.audit.installed,1); assert.equal(state.current.target.object_en,'a watering can'); assert.equal(state.displayed.target.object_en,'a watering can'); assert.equal(state.scene.spec.twist,.65);
    assert.equal(state.scene.count,glyphs+4); assert.deepEqual([state.audit.urlsCreated,state.audit.urlsRevoked],[1,1]);
  });

  await run('cancel during description prevents image stage; future writes work', async ({page,handlers,generations})=>{
    const gate=deferred(); handlers.describe=async route=>{await gate.promise;await route.fulfill({json:{text_en:'a vase'}});};
    await send(page,'花瓶','new'); await wait(page,s=>s.state.phase==='interpreting','description');
    await page.locator('#cancel').click(); await send(page,'四角く','edit'); gate.resolve();
    const state=await idle(page); assert.equal(state.accepted[0].state,'cancelled'); assert.deepEqual(generations,[]); assert.equal(state.scene.spec.squareness,1); assert.equal(state.current.target.form,'sphere');
  });

  await run('cancel during Blob loading invalidates geometry install and revokes URL', async ({page})=>{
    await page.evaluate(()=>{
      const original=window.fetch;
      window.fetch=async function(input,init) {
        if(typeof input==='string'&&input.startsWith('blob:')) {
          window.__blobWaiting=true;
          await new Promise(resolve=>window.__releaseBlob=resolve);
        }
        return original.call(this,input,init);
      };
    });
    await send(page,'じょうろ','new'); await page.waitForFunction(()=>window.__blobWaiting);
    let state=await inspect(page); assert.equal(state.state.phase,'installing'); assert.equal(state.audit.urlsCreated,1);
    await page.locator('#cancel').click(); await page.evaluate(()=>window.__releaseBlob()); state=await idle(page);
    assert.equal(state.audit.installed,0); assert.equal(state.scene.loaded,''); assert.equal(state.current.target.form,'sphere'); assert.equal(state.displayed.target.form,'sphere');
    assert.deepEqual([state.audit.urlsCreated,state.audit.urlsRevoked],[1,1]); assert.equal(state.accepted.length,1);
  });

  await run('invalid GLB retry releases both URLs without duplicate text', async ({page,handlers,generations})=>{
    let calls=0; handlers.generate=async route=>route.fulfill({body:++calls===1?Buffer.from('invalid GLB for an artificial failure'):mesh,contentType:'model/gltf-binary'});
    await send(page,'じょうろ','new'); let state=await idle(page); const glyphs=state.scene.count;
    assert.equal(state.state.canRetry,true); assert.equal(state.audit.installed,0); assert.deepEqual([state.audit.urlsCreated,state.audit.urlsRevoked],[1,1]);
    await page.locator('#retry').click(); state=await idle(page);
    assert.equal(state.audit.installed,1); assert.equal(state.scene.count,glyphs); assert.equal(state.accepted.length,1); assert.equal(generations.length,2);
    assert.deepEqual([state.audit.urlsCreated,state.audit.urlsRevoked],[2,2]);
  });

  await run('generation failure survives a later invalid edit; generation-only retry keeps all raw', async ({page,handlers,generations,expectedHttp})=>{
    expectedHttp.push({status:503,path:'/image-api/generate'});
    let calls=0;handlers.generate=async route=>route.fulfill(++calls===1?{status:503,json:{error:'mock busy'}}:{body:mesh,contentType:'model/gltf-binary'});
    await send(page,'じょうろ','new');await idle(page);
    await send(page,'大きく','edit');let state=await idle(page);
    assert.equal(state.accepted[1].state,'failed');assert.equal(state.state.canRetryGeneration,true);
    assert.equal(state.state.canRetry,true);const count=state.scene.count;
    await page.locator('#retry-generation').click();state=await idle(page);
    assert.equal(state.audit.installed,1);assert.equal(state.scene.count,count);assert.equal(state.accepted.length,2);
    assert.equal(state.displayed.target.object_en,'a watering can');assert.equal(generations.length,2);
    assert.deepEqual(state.accepted.map(e=>e.raw),['じょうろ','大きく']);
    assert.equal(state.state.canRetryGeneration,false);
  });
} finally {
  await browser.close(); await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2)+'\n',{flag:'wx'});
}
if(results.errors.length)process.exitCode=1;

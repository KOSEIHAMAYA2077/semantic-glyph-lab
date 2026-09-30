import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root=fileURLToPath(new URL('../../',import.meta.url));
const output=path.resolve(root,'experiments/writing-preview',process.argv[2]||'real-v1');
const replay=process.argv[3]==='--fixture-replay';
await mkdir(output,{recursive:false});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});
const results={at:new Date().toISOString(),modelPath:replay?'fixture replay only; no real model; not the real-v1 generated mesh':'description-api/describe -> image-api/generate; no mock',artificialInputs:['取っ手が二つ付いた丸い花瓶','四角く','水面を光が流れる。'],events:[],errors:[],externalRequests:[]};
const start=performance.now();
let responseTasks=[];
page.on('pageerror',e=>results.errors.push(e.message));
page.on('console',e=>{if(e.type()==='error')results.errors.push({text:e.text(),location:e.location().url});});
page.on('request',r=>{
  if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:4183/'))results.externalRequests.push(r.url());
  if(r.url().includes('-api/'))results.events.push({event:'request',url:new URL(r.url()).pathname,seconds:(performance.now()-start)/1000,body:r.postDataJSON()});
});
page.on('response',r=>{
  if(!r.url().includes('-api/'))return;
  responseTasks.push((async()=>{
    const record={event:'response',url:new URL(r.url()).pathname,status:r.status(),seconds:(performance.now()-start)/1000,headers:await r.allHeaders()};
    if(r.url().includes('/describe'))record.body=await r.json();
    // The browser's response.body() returned an empty buffer on this binary
    // response once. Capture the Blob actually consumed by the app instead.
    else if(!r.ok())record.body=await r.text();
    results.events.push(record);
  })());
});
try {
  if(replay) {
    results.fixture='public/text-image-models/mesh128-first/vase-y-up.glb';
    const bytes=await readFile(path.join(root,results.fixture));results.fixtureSHA256=createHash('sha256').update(bytes).digest('hex');
    await page.route('**/description-api/describe',route=>route.fulfill({json:{text_en:'a round vase with two handles'}}));
    await page.route('**/image-api/generate',async route=>{await new Promise(resolve=>setTimeout(resolve,1000));await route.fulfill({body:bytes,contentType:'model/gltf-binary'});});
  }
  await page.goto('http://127.0.0.1:4183/src/writing-preview/index.html'); await page.waitForFunction(()=>Boolean(window.__writing));
  await page.evaluate(()=>{
    const original=URL.createObjectURL;
    URL.createObjectURL=function(blob){window.__generatedCapture=blob.arrayBuffer();return original.call(this,blob);};
  });
  await page.locator('#mode').selectOption('new'); await page.locator('#text').fill(results.artificialInputs[0]); await page.locator('#text').press('Enter');
  await page.waitForFunction(()=>window.__writing.inspect().state.phase==='generating',{},{timeout:90_000});
  for(const [text,mode] of [[results.artificialInputs[1],'edit'],[results.artificialInputs[2],'keep']]) {
    await page.locator('#mode').selectOption(mode);await page.locator('#text').fill(text);await page.locator('#text').press('Enter');
  }
  results.waiting=await page.evaluate(()=>window.__writing.inspect());
  assert.equal(results.waiting.accepted.length,3);assert.equal(results.waiting.audit.installed,0);
  assert.equal(results.waiting.displayed.target.form,'sphere');assert.equal(results.waiting.current.target.form,null);
  assert.equal(results.waiting.scene.count,1+Array.from(results.artificialInputs.join('')).length);
  await page.screenshot({path:path.join(output,'waiting.png')});console.log('All 3 artificial paragraphs accepted during generation; original mesh remains.');
  await page.waitForFunction(()=>window.__writing.inspect().state.phase==='idle',{},{timeout:300_000});
  await Promise.all(responseTasks);
  results.final=await page.evaluate(()=>window.__writing.inspect());
  const captured=await page.evaluate(async()=>Array.from(new Uint8Array(await window.__generatedCapture)));
  const bytes=Buffer.from(captured); assert(bytes.length>20);
  results.artifact={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  await writeFile(path.join(output,replay?'fixture-copy.glb':'generated.glb'),bytes,{flag:'wx'});
  if(replay)assert.equal(results.artifact.sha256,results.fixtureSHA256);
  assert.equal(results.final.audit.installed,1);assert.equal(results.final.scene.spec.squareness,1);assert.equal(results.final.current.target.form,null);
  assert.equal(results.final.scene.count,results.waiting.scene.count);assert.equal(results.final.audit.urlsCreated,results.final.audit.urlsRevoked);
  assert.deepEqual(results.final.accepted.map(e=>e.raw),results.artificialInputs);assert.deepEqual(results.errors,[]);assert.deepEqual(results.externalRequests,[]);assert.equal(results.final.scene.gpuError,0);
  await page.screenshot({path:path.join(output,'installed.png')});
  results.pass=true;console.log(`PASS ${replay?'fixture replay (no model)':'real model'}: latest attributes installed, all input retained, no GL/JS/external request.`);
} catch(error) {
  results.pass=false;results.failure=String(error);console.log(`FAIL ${error}`);
  await page.screenshot({path:path.join(output,'failure.png')});process.exitCode=1;
} finally {
  results.seconds=(performance.now()-start)/1000;await Promise.allSettled(responseTasks);
  await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2)+'\n',{flag:'wx'});await browser.close();
}

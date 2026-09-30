import { chromium, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Read-only browser smoke test against the built, separately served dist tree.
// Every run has its own directory; existing evidence is never overwritten.
const base = 'http://127.0.0.1:4191';
const run = `run-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
const output = resolve('experiments/surface-05/build-smoke-v1', run);
await mkdir(output, { recursive:false });
const result = {
  startedUTC:new Date().toISOString(), base, pass:false,
  inputs:['  青い文字\n二行目  ', '四角く'],
  checks:{}, requests:[], networkErrors:[], consoleErrors:[], javascriptErrors:[], forbiddenRequests:[],
  note:'Fixed synthetic input only. No generation, description, composition, or interpretation API call is allowed.',
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
result.buildFiles = {};
for(const file of ['dist/index.html','dist/src/writing-preview/index.html']) {
  const bytes = await readFile(file);
  result.buildFiles[file] = { bytes:bytes.length, sha256:sha256(bytes) };
}
let browser;
try {
  browser = await chromium.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  result.browser = browser.version();
  const context = await browser.newContext({ viewport:{width:1280,height:900}, deviceScaleFactor:1 });
  context.on('page', page => {
    page.on('pageerror', error => result.javascriptErrors.push({page:new URL(page.url() || base).pathname,message:error.message}));
    page.on('console', message => {
      if(message.type()==='error')result.consoleErrors.push({page:new URL(page.url() || base).pathname,message:message.text()});
    });
  });
  context.on('requestfailed', request => result.networkErrors.push({url:request.url(),error:request.failure()?.errorText}));
  context.on('response', response => {
    const request=response.request();
    result.requests.push({method:request.method(),url:response.url(),status:response.status()});
  });
  await context.route('**/*', async route => {
    const request=route.request(), url=new URL(request.url());
    const forbidden = url.origin!==base || request.method()!=='GET'
      || /^\/(?:description-api|image-api|generate-api|compose-api|retrieval-api)(?:\/|$)/.test(url.pathname)
      || url.pathname==='/api/interpret';
    if(forbidden) {
      result.forbiddenRequests.push({method:request.method(),url:request.url()});
      await route.abort('blockedbyclient');
    } else await route.continue();
  });
  const normal=await context.newPage();
  const response=await normal.goto(base+'/');
  expect(response.status()).toBe(200);
  await expect(normal.locator('canvas')).toBeVisible();
  await normal.locator('#compare-open').click();
  const entry=normal.getByRole('link',{name:'連続入力の試作を開く',exact:true});
  await expect(entry).toHaveAttribute('href','/src/writing-preview/index.html');
  await expect(entry).toHaveAttribute('target','_blank');
  result.checks.normalEntry=true;
  result.normalGL=await normal.locator('canvas').evaluate(canvas=>canvas.getContext('webgl2').getError());
  expect(result.normalGL).toBe(0);
  const popupPromise=normal.waitForEvent('popup');
  await entry.click();
  const writing=await popupPromise;
  await writing.waitForLoadState('networkidle');
  expect(writing.url()).toBe(base+'/src/writing-preview/index.html');
  await writing.waitForFunction(()=>Boolean(window.__writing));
  await expect(writing.getByRole('combobox',{name:'この入力の操作'})).toHaveValue('keep');
  result.checks.builtWritingEntry=true;
  const inspect=()=>writing.evaluate(()=>window.__writing.inspect());
  const initial=await inspect();
  await writing.locator('#text').fill(result.inputs[0]);
  await writing.locator('#text').press('Enter');
  await writing.evaluate(()=>window.__writing.whenIdle());
  await expect(writing.locator('#text')).toHaveValue('');
  const added=await inspect();
  expect(added.scene.spec).toEqual(initial.scene.spec);
  expect(added.accepted.map(entry=>entry.raw)).toEqual([result.inputs[0]]);
  expect(added.accepted[0].mode).toBe('keep');
  expect(added.scene.letters.map(letter=>letter.text).join('')).toBe('@青い文字二行目');
  result.checks.keepAppendsOnceAndPreservesShape=true;
  await writing.getByRole('combobox',{name:'この入力の操作'}).selectOption({label:'今の形を変える'});
  await writing.locator('#text').fill(result.inputs[1]);
  await writing.locator('#text').press('Enter');
  await writing.evaluate(()=>window.__writing.whenIdle());
  await writing.waitForFunction(()=>window.__writing.inspect().scene.spec.squareness===1);
  const edited=await inspect();
  expect(edited.scene.spec.object).toBe(initial.scene.spec.object);
  expect(edited.scene.letters.slice(0,added.scene.count)).toEqual(added.scene.letters);
  expect(edited.scene.letters.map(letter=>letter.text).join('')).toBe('@青い文字二行目四角く');
  expect(edited.accepted.map(entry=>({raw:entry.raw,mode:entry.mode,state:entry.state}))).toEqual([
    {raw:result.inputs[0],mode:'keep',state:'applied'},
    {raw:result.inputs[1],mode:'edit',state:'applied'},
  ]);
  result.checks.attributeEdit=true;
  await writing.locator('#history summary').click();
  expect(await writing.locator('#entries pre').allTextContents()).toEqual(result.inputs);
  result.checks.rawTextRetainedIncludingWhitespace=true;
  // Finish the visible geometry interpolation before pausing the production UI.
  await writing.waitForFunction(time=>window.__writing.inspect().scene.time>time+1.7,edited.scene.time);
  await writing.getByRole('button',{name:'一時停止',exact:true}).click();
  await expect(writing.locator('#pause')).toHaveAttribute('aria-pressed','true');
  await expect(writing.locator('#pause')).toHaveText('再開');
  const paused=await inspect(), pixels=await writing.locator('canvas').screenshot();
  await writing.waitForFunction(frame=>window.__writing.inspect().scene.frames>frame+6,paused.scene.frames);
  expect((await inspect()).scene.time).toBe(paused.scene.time);
  expect((await writing.locator('canvas').screenshot()).equals(pixels)).toBe(true);
  result.checks.pauseStopsSceneAndPixels=true;
  await writing.getByRole('button',{name:'再開',exact:true}).click();
  await writing.waitForFunction(time=>window.__writing.inspect().scene.time>time,paused.scene.time);
  await writing.getByRole('button',{name:'一時停止',exact:true}).click();
  result.checks.resumeWorks=true;
  const final=await inspect();
  expect(final.scene.gpuError).toBe(0);
  expect(final.state.error).toBe('');
  expect(final.state.phase).toBe('idle');
  expect(final.audit).toMatchObject({accepted:2,installed:0,urlsCreated:0,urlsRevoked:0});
  expect(result.javascriptErrors).toEqual([]);
  expect(result.consoleErrors).toEqual([]);
  expect(result.networkErrors).toEqual([]);
  expect(result.forbiddenRequests).toEqual([]);
  expect(result.requests.filter(request=>request.status>=400)).toEqual([]);
  expect(result.requests.some(request=>request.url===base+'/src/writing-preview/index.html'&&request.status===200)).toBe(true);
  result.checks.noGenerationOrExternalCalls=true;
  result.checks.noNetworkJavascriptOrGLErrors=true;
  result.final={spec:final.scene.spec,letterCount:final.scene.count,raw:final.accepted,paused:final.scene.paused,gpuError:final.scene.gpuError,state:final.state,audit:final.audit};
  result.screenshot='writing-paused.png';
  await writing.screenshot({path:resolve(output,result.screenshot)});
  result.pass=true;
} catch(error) {
  result.failure={name:error.name,message:error.message};
  process.exitCode=1;
} finally {
  await browser?.close();
  result.finishedUTC=new Date().toISOString();
  await writeFile(resolve(output,'result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({pass:result.pass,output,checks:result.checks,failure:result.failure},null,2));
}

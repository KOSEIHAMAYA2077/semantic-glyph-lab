import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const mode=process.argv[2]??'screens';
if(!['screens','performance'].includes(mode))throw Error('Use screens or performance');
const out=new URL(`./${mode}/`,import.meta.url);await mkdir(out,{recursive:false});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});
const pageErrors=[],consoleErrors=[],externalRequests=[];
page.on('pageerror',error=>pageErrors.push(String(error)));
page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
page.on('request',request=>{if(!/^(http:\/\/127\.0\.0\.1:4183\/|blob:|data:)/.test(request.url()))externalRequests.push(request.url());});
await page.route('**/api/health',route=>route.fulfill({contentType:'application/json',body:'{"semanticReady":false}'}));
const inspect=()=>page.evaluate(()=>{const {letters,...value}=window.__SEMANTIC_GLYPH__.inspect();return value;});
const feed=async text=>{
 await page.locator('#input-open').click();await page.locator('#text').fill(text);await page.locator('#text').press('Enter');
 await page.waitForFunction(()=>document.querySelector('#entry').hidden);
};
await page.goto('http://127.0.0.1:4183/');await page.waitForFunction(()=>Boolean(window.__SEMANTIC_GLYPH__));
await page.evaluate(()=>window.__SEMANTIC_GLYPH__.pause());
await page.locator('#compare-open').click();await page.locator('#method').selectOption('rules');await page.locator('#rotation').uncheck();
await page.locator('#close-panel').click();
const phrase='花木水風雪月雲あいうえおabcdef012345';
const artificial=n=>'白い'+phrase.repeat(Math.ceil(n/phrase.length)).slice(0,n-2);
await feed(artificial(2000));await feed(artificial(2095));
await page.evaluate(()=>window.__SEMANTIC_GLYPH__.pause());
const startup=await inspect();if(startup.count!==4096)throw Error(`Expected 4096 letters: ${startup.count}`);
await page.locator('#compare-open').click();await page.locator('#flow').fill(mode==='performance'?'1':'0');
await page.locator('#body-motion').fill('1');await page.locator('#render-mode').selectOption('advection');await page.locator('#close-panel').click();
const platform=await page.evaluate(()=>{const gl=document.querySelector('canvas').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return {userAgent:navigator.userAgent,pixelRatio:devicePixelRatio,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):null,width:gl.drawingBufferWidth,height:gl.drawingBufferHeight};});
const snapshots=[];
try {
 if(mode==='screens'){
  for(const asset of ['tree_oak','flower_purpleA','mushroom_red']){
   await page.locator('#compare-open').click();await page.locator('#asset').selectOption(asset);await page.locator('#load-asset').click();
   await page.waitForFunction(asset=>window.__SEMANTIC_GLYPH__.inspect().loaded.endsWith(`${asset}.obj`),asset);
   // Asset loading retains time. Step by a negative delta only in this paused,
   // test-only hook to set the common absolute phase without editing app code.
   const now=(await inspect()).time;await page.evaluate(now=>window.__SEMANTIC_GLYPH__.step(-now),now);
   for(const time of [0,8,16]){
    if(time)await page.evaluate(()=>window.__SEMANTIC_GLYPH__.step(8));
    const state=await inspect();snapshots.push({asset,requestedTime:time,...state});
    await page.locator('canvas').screenshot({path:new URL(`${asset}-t${time}.png`,out).pathname});
    if(state.gpuError!==0)throw Error(`GPU error ${state.gpuError}`);
   }
  }
 }else{
  await page.locator('#compare-open').click();await page.locator('#generated').selectOption('/reconstructed/mps128-y-up/triposr-horse-y-up.glb');await page.locator('#load-generated').click();
  await page.waitForFunction(()=>window.__SEMANTIC_GLYPH__.inspect().loaded.includes('triposr-horse'));
  await page.evaluate(()=>window.__SEMANTIC_GLYPH__.pause(false));
  const measurement=await page.evaluate(async()=>{
   for(let i=0;i<30;i++)await new Promise(requestAnimationFrame);
   const timestamps=[];for(let i=0;i<241;i++)timestamps.push(await new Promise(requestAnimationFrame));
   const intervals=timestamps.slice(1).map((t,i)=>t-timestamps[i]),ordered=[...intervals].sort((a,b)=>a-b);
   const percentile=p=>ordered[Math.ceil(ordered.length*p)-1];
   window.__SEMANTIC_GLYPH__.pause();
   return {warmupFrames:30,frames:intervals.length,intervals,medianMs:percentile(.5),p95Ms:percentile(.95),p99Ms:percentile(.99),maxMs:ordered.at(-1),meanMs:intervals.reduce((a,b)=>a+b,0)/intervals.length};
  });
  const state=await inspect();snapshots.push({...state,measurement});
  await page.locator('canvas').screenshot({path:new URL('horse-4096.png',out).pathname});
  if(state.gpuError!==0)throw Error(`GPU error ${state.gpuError}`);
 }
}finally{
 await writeFile(new URL('results.json',out),JSON.stringify({mode,platform,startup,snapshots,pageErrors,consoleErrors,externalRequests},null,2),{flag:'wx'});
 await browser.close();
}
if(pageErrors.length||consoleErrors.length||externalRequests.length)throw Error(JSON.stringify({pageErrors,consoleErrors,externalRequests}));
console.log(JSON.stringify({mode,snapshots:snapshots.length,measurement:snapshots.at(-1)?.measurement,pageErrors,consoleErrors,externalRequests},null,2));

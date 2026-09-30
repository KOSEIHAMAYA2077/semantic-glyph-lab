import {chromium} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const label=process.argv[2];if(!label||!/^[a-zA-Z0-9-]+$/.test(label))throw Error('Provide a new output name');
const out=new URL(`./${label}/`,import.meta.url);await mkdir(out,{recursive:false});
const base='http://127.0.0.1:4192',browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:1280,height:900},deviceScaleFactor:1});
const errors=[],consoleErrors=[],externalRequests=[],samples=[],timings=[],checks={},sourceSha256={};
for(const name of ['src/renewed-flow/field.ts','src/renewed-flow/material.ts','src/renewed-flow/preview.ts','src/renewed-flow/renewal.ts','src/fluid/field.ts','src/letters.ts'])sourceSha256[name]=createHash('sha256').update(await readFile(new URL(`../../${name}`,import.meta.url))).digest('hex');
context.on('page',p=>{p.setDefaultTimeout(120000);p.on('pageerror',e=>errors.push(String(e)));p.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});p.on('request',r=>{if(!r.url().startsWith(base+'/')&&!/^(data:|blob:)/.test(r.url()))externalRequests.push(r.url());});});
const page=await context.newPage();let completed=false,failure;const startedAt=new Date().toISOString();
try{
 await page.goto(base+'/src/renewed-flow/preview.html?paused=1');await page.waitForFunction(()=>document.body.dataset.ready==='true');
 await page.evaluate(()=>window.__renew.advance(1));const first=await page.evaluate(()=>window.__renew.sample());
 await page.evaluate(()=>window.__renew.reset());await page.evaluate(()=>window.__renew.advance(1));
 checks.deterministicSample=JSON.stringify(first)===JSON.stringify(await page.evaluate(()=>window.__renew.sample()));
 const old=await context.newPage();await old.goto(base+'/src/fluid/preview.html?paused=1');await old.waitForFunction(()=>document.body.dataset.ready==='true');
 await old.evaluate(()=>window.__fluid.advance(1));checks.originalVelocityAndBaselineSampleUnchanged=JSON.stringify(first)===JSON.stringify(await old.evaluate(()=>window.__fluid.sample()));
 await old.close();
 await page.locator('#pause').click();await page.waitForTimeout(300);await page.locator('#pause').click();
 checks.pauseResume=(await page.evaluate(()=>window.__renew.inspect())).steps>60;
 await page.locator('#reset').click();checks.reset=(await page.evaluate(()=>window.__renew.inspect())).steps===0;
 let prior=0;const ticks=[...Array.from({length:42},(_,i)=>i*900),1799,1801,35999,36001].sort((a,b)=>a-b);
 for(const tick of ticks){
  if(tick>prior)await page.evaluate(s=>window.__renew.advance(s),(tick-prior)/60);prior=tick;
  const state=await page.evaluate(()=>window.__renew.inspect());samples.push({requestedTick:tick,...state});
  if(!state.simulation.finite||state.simulation.gpuError||state.gpuError||state.renewal.maps.some(m=>!m.finite))throw Error('Invalid numerical state');
  if(tick%900===0)console.log(JSON.stringify({time:state.time,baseline:state.renewal.baseline.symmetricStretchP95,renewed:state.renewal.maps.map(m=>m.symmetricStretchP95),weight:state.renewal.phase.weightA}));
  if([0,900,1799,1800,1801,2700,18000,18900,35100,35999,36000,36001,36900].includes(tick)){
   for(const mode of ['fluid','renew','coordinates']){
    await page.locator('#mode').selectOption(mode);
    await page.locator('canvas').screenshot({path:new URL(`sphere-${mode}-step${tick}.png`,out).pathname});
    if((await page.evaluate(()=>window.__renew.inspect())).steps!==tick)throw Error('Mode switch altered simulation time');
   }
  }
 }
 checks.fixedClock=(await page.evaluate(()=>window.__renew.inspect())).steps===36900;
 for(const shape of ['vase','can']){
  await page.evaluate(s=>window.__renew.choose(s,true),shape);
  for(const mode of ['fluid','renew','coordinates']){
   await page.locator('#mode').selectOption(mode);await page.locator('canvas').screenshot({path:new URL(`${shape}-${mode}-step36900.png`,out).pathname});
  }
 }
 // All candidate display modes use the same shared solver, including the
 // uninterrupted diagnostic map. This is an upper bound for the experiment,
 // not a measurement of a separately optimized production implementation.
 await page.evaluate(()=>window.__renew.choose('sphere'));
 for(const mode of ['fluid','renew','coordinates']){
  await page.locator('#mode').selectOption(mode);await page.evaluate(()=>window.__renew.pause(false));
  const timing=await page.evaluate(async()=>{
   for(let i=0;i<30;i++)await new Promise(requestAnimationFrame);
   const stamps=[];for(let i=0;i<241;i++)stamps.push(await new Promise(requestAnimationFrame));
   window.__renew.pause();const intervals=stamps.slice(1).map((n,i)=>n-stamps[i]).sort((a,b)=>a-b);
   return{frames:240,medianMs:intervals[119],p95Ms:intervals[227],p99Ms:intervals[237]};
  });timings.push({mode,...timing,...await page.evaluate(()=>window.__renew.inspect())});
 }
 if(Object.values(checks).some(v=>v!==true)||errors.length||consoleErrors.length||externalRequests.length)throw Error('Browser checks failed');
 completed=true;
}catch(e){failure=String(e);throw e;}finally{
 await writeFile(new URL('results.json',out),JSON.stringify({startedAt,finishedAt:new Date().toISOString(),completed,failure,sourceSha256,scope:'615 seconds of fixed-step simulation, not 615 seconds of wall-clock or a 30-minute stability test. Timing includes uninterrupted diagnostic map plus both renewed maps.',checks,samples,timings,errors,consoleErrors,externalRequests},null,2),{flag:'wx'});await browser.close();
}

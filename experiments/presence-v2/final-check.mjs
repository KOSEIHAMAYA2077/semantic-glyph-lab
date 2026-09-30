import {chromium} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const label=process.argv[2]??'final-v1';if(!/^[a-z0-9-]+$/.test(label))throw Error('Use new output label');
const out=new URL(`./${label}/`,import.meta.url);await mkdir(out,{recursive:false});
const files=['src/presence/main.ts','src/presence/layer.ts','src/scene.ts'];
async function hashes(){const h={};for(const f of files)h[f]=createHash('sha256').update(await readFile(new URL(`../../${f}`,import.meta.url))).digest('hex');return h;}
const sourceBefore=await hashes(),browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1200,height:900},deviceScaleFactor:1});page.setDefaultTimeout(60000);
const checks={},errors=[],external=[],measurements=[];let failure,completed=false;
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:4193/')&&!/^(blob|data):/.test(r.url()))external.push(r.url());});
const feed=async text=>{await page.keyboard.press('Enter');await page.fill('#text',text);await page.press('#text','Enter');await page.waitForFunction(()=>document.querySelector('#entry').hidden);};
try{
 await page.goto('http://127.0.0.1:4193/src/presence/index.html');await page.waitForFunction(()=>window.__PRESENCE__);
 await feed('白い球体。あいうえお、かきくけこ、さしすせそ。0123456789 abcdef');await page.evaluate(()=>window.__PRESENCE__.pause());
 for(const shape of ['sphere','vase','cube']){
  await page.evaluate(shape=>window.__PRESENCE__.choose(shape),shape);await page.evaluate(()=>window.__PRESENCE__.pause());
  for(let i=0;i<60;i++)await page.evaluate(()=>window.__PRESENCE__.step(5));
  const s=await page.evaluate(()=>window.__PRESENCE__.inspect());
  measurements.push({shape,simulatedSeconds:300,presence:s.presence,camera:s.camera,gpuError:s.gpuError});
  if(s.presence.boundaryStops||s.presence.iterationStops||s.gpuError)throw Error('Endurance failed');
  await page.screenshot({path:new URL(`${shape}-300.png`,out).pathname});
  console.log(`${shape}: 300 simulation seconds`);
 }
 await page.click('#shape-open');await page.locator('#speed').fill('0');await page.locator('#speed').dispatchEvent('input');await page.click('#close-panel');
 const before=await page.evaluate(()=>window.__PRESENCE__.inspect());await page.click('#input-open');await page.fill('#text','青い立方体');await page.press('#text','Enter');await page.evaluate(()=>window.__PRESENCE__.pause());await page.evaluate(()=>window.__PRESENCE__.step(2));
 const after=await page.evaluate(()=>window.__PRESENCE__.inspect());checks.zeroFlowSameShapePositions=JSON.stringify(before.presence.samples.map(x=>x.position))===JSON.stringify(after.presence.samples.map(x=>x.position));checks.zeroFlowNewInk=after.presence.activePendingReassign===0&&after.count>before.count;
 await page.click('#input-open');await page.fill('#text','😀'.repeat(2001));await page.press('#text','Enter');await page.waitForFunction(()=>document.querySelector('#entry').hidden);checks.emoji2001Accepted=(await page.evaluate(()=>window.__PRESENCE__.inspect().count))===after.count+2001;
 await page.click('#input-open');await page.fill('#text','あ'.repeat(4001));await page.press('#text','Enter');checks.largeInputRetained=(await page.inputValue('#text')).length===4001;checks.largeInputMessage=(await page.textContent('#message')).includes('分けて');await page.keyboard.press('Escape');
 // A fresh context avoids atlas density from the boundary-case input in timing.
 const timing=await browser.newPage({viewport:{width:1200,height:900},deviceScaleFactor:1});
 timing.on('pageerror',e=>errors.push(String(e)));await timing.goto('http://127.0.0.1:4193/src/presence/index.html');await timing.waitForFunction(()=>window.__PRESENCE__);await timing.keyboard.press('Enter');await timing.fill('#text','白い球体。あいうえおかきくけこ 0123456789');await timing.press('#text','Enter');
 const perf=await timing.evaluate(async()=>{for(let i=0;i<240;i++)await new Promise(requestAnimationFrame);const stamps=[];for(let i=0;i<601;i++)stamps.push(await new Promise(requestAnimationFrame));const intervals=stamps.slice(1).map((v,i)=>v-stamps[i]),sorted=[...intervals].sort((a,b)=>a-b),q=p=>sorted[Math.ceil(sorted.length*p)-1];const gl=document.querySelector('canvas').getContext('webgl2'),info=gl.getExtension('WEBGL_debug_renderer_info');return{intervals,medianMs:q(.5),p95Ms:q(.95),p99Ms:q(.99),frames:600,wallMs:stamps.at(-1)-stamps[0],userAgent:navigator.userAgent,graphics:info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):'not exposed',state:window.__PRESENCE__.inspect()};});measurements.push({realTime:perf});await timing.close();
 checks.sourcesUnchanged=JSON.stringify(sourceBefore)===JSON.stringify(await hashes());if(!Object.values(checks).every(Boolean)||errors.length||external.length)throw Error('Final checks failed');completed=true;
}catch(e){failure=String(e);throw e;}finally{await writeFile(new URL('results.json',out),JSON.stringify({label,completed,failure,sourceBefore,sourceAfter:await hashes(),checks,errors,external,measurements},null,2));await browser.close();}

import {chromium} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const label=process.argv[2]??'endurance-v1';if(!/^[a-z0-9-]+$/.test(label))throw Error('Use new output label');
const out=new URL(`./${label}/`,import.meta.url);await mkdir(out,{recursive:false});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1200,height:900},deviceScaleFactor:1});page.setDefaultTimeout(60000);
const errors=[],external=[],samples=[];let completed=false,failure;
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:4193/')&&!/^(blob|data):/.test(r.url()))external.push(r.url());});
const compact=s=>{const {letters,frameTimes,...rest}=s;return rest;};
try{
 await page.goto('http://127.0.0.1:4193/src/presence/index.html');await page.waitForFunction(()=>window.__PRESENCE__);await page.keyboard.press('Enter');
 await page.fill('#text','白い球体。あいうえお かきくけこ さしすせそ たちつてと。abcdef 0123456789 @');await page.press('#text','Enter');await page.waitForFunction(()=>window.__PRESENCE__.inspect().awakened);await page.evaluate(()=>window.__PRESENCE__.pause());
 for(const shape of ['sphere','vase','cube']){
  await page.evaluate(shape=>window.__PRESENCE__.choose(shape),shape);await page.evaluate(()=>window.__PRESENCE__.pause());
  const started=await page.evaluate(()=>window.__PRESENCE__.inspect().time);const startWall=Date.now();
  for(const target of [0,30,120,300]){
   let delta=target-(samples.at(-1)?.shape===shape?samples.at(-1).requestedTime:0);
   while(delta>0){const step=Math.min(delta,5);await page.evaluate(seconds=>window.__PRESENCE__.step(seconds),step);delta-=step;}
   const state=await page.evaluate(()=>window.__PRESENCE__.inspect());samples.push({shape,requestedTime:target,elapsedWallMs:Date.now()-startWall,simulatedSinceStart:state.time-started,...compact(state)});
   await page.screenshot({path:new URL(`${shape}-${target}.png`,out).pathname});
   if(state.gpuError||state.presence.iterationStops||state.presence.boundaryStops)throw Error(`Motion failed ${shape}@${target}`);
   console.log(JSON.stringify({shape,seconds:target,wallMs:Date.now()-startWall,stops:state.presence.iterationStops,crossings:state.presence.crossings}));
  }
 }
 // Zero flow must still accept and display new ink without moving old anchors.
 await page.click('#shape-open');await page.locator('#speed').fill('0');await page.locator('#speed').dispatchEvent('input');await page.click('#close-panel');
 const before=await page.evaluate(()=>window.__PRESENCE__.inspect());await page.click('#input-open');await page.fill('#text','青い新しい文字');await page.press('#text','Enter');await page.evaluate(()=>window.__PRESENCE__.pause());await page.evaluate(()=>window.__PRESENCE__.step(2));
 const after=await page.evaluate(()=>window.__PRESENCE__.inspect());
 const flowZero={positionsKept:JSON.stringify(before.presence.samples.map(x=>x.position))===JSON.stringify(after.presence.samples.map(x=>x.position)),newInkSettled:after.presence.activePendingReassign===0,added:after.count>before.count};
 samples.push({flowZero});if(!Object.values(flowZero).every(Boolean))throw Error('Zero flow input failed');
 await page.screenshot({path:new URL('zero-flow-new-ink.png',out).pathname});
 if(errors.length||external.length)throw Error('Browser/network errors');completed=true;
}catch(e){failure=String(e);throw e;}finally{
 const hashes={};for(const name of ['src/presence/main.ts','src/presence/layer.ts','src/scene.ts'])hashes[name]=createHash('sha256').update(await readFile(new URL(`../../${name}`,import.meta.url))).digest('hex');
 await writeFile(new URL('results.json',out),JSON.stringify({label,completed,failure,hashes,errors,external,samples},null,2));await browser.close();
}

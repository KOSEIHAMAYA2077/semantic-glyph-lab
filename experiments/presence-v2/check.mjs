import { chromium } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const label=process.argv[2]??'check-v1';if(!/^[a-z0-9-]+$/.test(label))throw Error('Use new output label');
const dir=new URL(`./${label}/`,import.meta.url);await mkdir(dir,{recursive:false});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1200,height:900},deviceScaleFactor:1});
page.setDefaultTimeout(30000);
const errors=[],external=[],snapshots=[],checks={};let completed=false,failure;
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:4193/')&&!r.url().startsWith('data:')&&!r.url().startsWith('blob:'))external.push(r.url());});
const shot=async name=>{await page.screenshot({path:new URL(`${name}.png`,dir).pathname});};
const inspect=()=>page.evaluate(()=>window.__PRESENCE__.inspect());
async function submit(text){await page.click('#input-open');await page.fill('#text',text);await page.press('#text','Enter');await page.waitForFunction(()=>document.querySelector('#entry').hidden);}
try{
 await page.goto('http://127.0.0.1:4193/src/presence/index.html');await page.waitForFunction(()=>window.__PRESENCE__);await page.evaluate(()=>document.fonts.ready);
 await page.evaluate(()=>window.__PRESENCE__.pause());await shot('start');checks.initialSeed=(await inspect()).count===1&&!(await page.locator('#actions').isVisible());
 await page.keyboard.press('Enter');checks.enterOpens=await page.locator('#text').isVisible();await page.fill('#text','白い球体。あいうえおかきくけこ、さしすせそ。abcdef 0123456789 @');await page.press('#text','Enter');
 await page.waitForFunction(()=>window.__PRESENCE__.inspect().awakened);await page.evaluate(()=>window.__PRESENCE__.pause());await shot('intake-start');await page.evaluate(()=>window.__PRESENCE__.step(4));await shot('sphere-first');
 const first=await inspect();checks.firstShape=first.spec.object==='sphere';checks.actionsAfterInput=await page.locator('#actions').isVisible();checks.noIntakeLeak=first.intake===0;
 for(const shape of ['sphere','cube','vase']){
  await page.click('#shape-open');await page.selectOption('#shape',shape);await page.click('#close-panel');await page.evaluate(()=>window.__PRESENCE__.pause());
  for(const mode of ['presence','advection','texture']){
   await page.evaluate(mode=>window.__PRESENCE__.mode(mode),mode);await page.evaluate(()=>window.__PRESENCE__.step(0));
   snapshots.push({shape,mode,...await inspect()});await shot(`${shape}-${mode}`);
  }
 }
 await page.evaluate(()=>window.__PRESENCE__.mode('presence'));
 const before=await inspect();await submit('青い記憶、新しい文字がここから加わる。');await page.evaluate(()=>window.__PRESENCE__.pause());
 const added=await inspect();checks.previousTextAndColorsKept=JSON.stringify(added.letters.slice(0,before.count))===JSON.stringify(before.letters);checks.onlyNewBlue=added.letters.slice(before.count).every(l=>l.ink==='#79a7ff');checks.appendDidNotReset=added.presence.crossings>=before.presence.crossings;checks.appendedCount=added.count>before.count;
 await page.evaluate(()=>window.__PRESENCE__.step(4));await shot('new-blue-vase');
 const sameBefore=await inspect();await submit('青い花瓶');await page.evaluate(()=>window.__PRESENCE__.pause());const sameAfter=await inspect();checks.sameShapeKeepsFlow=sameAfter.presence.crossings>=sameBefore.presence.crossings&&sameAfter.presence.distanceTraveled>=sameBefore.presence.distanceTraveled;
 await page.click('#shape-open');await page.selectOption('#shape','generated-can');await page.waitForFunction(()=>window.__PRESENCE__.inspect().loaded.includes('watering-can'));
 await page.click('#close-panel');await page.evaluate(()=>window.__PRESENCE__.pause());await page.evaluate(()=>window.__PRESENCE__.step(3));await shot('generated-can');snapshots.push({shape:'generated-can',...await inspect()});
 const oldLoaded=(await inspect()).loaded;await submit('四角くねじれた');await page.evaluate(()=>window.__PRESENCE__.pause());checks.importRetained=(await inspect()).loaded===oldLoaded;await page.evaluate(()=>window.__PRESENCE__.step(3));await shot('generated-can-twisted');
 await page.click('#input-open');const n=(await inspect()).count;await page.fill('#text','花瓶');await page.locator('#text').dispatchEvent('compositionstart');await page.press('#text','Enter');checks.compositionGuard=(await inspect()).count===n;await page.locator('#text').dispatchEvent('compositionend');await page.waitForTimeout(100);await page.press('#text','Enter');await page.waitForFunction(()=>document.querySelector('#entry').hidden);checks.compositionSentOnce=(await inspect()).count===n+2;
 await page.click('#input-open');await page.fill('#text','  ');await page.press('#text','Enter');checks.emptyRetained=await page.locator('#entry').isVisible();await page.keyboard.press('Escape');
 const stopped=(await inspect()).time;await page.evaluate(()=>window.__PRESENCE__.pause());const stopped2=(await inspect()).time;await page.waitForTimeout(200);checks.pause=(await inspect()).time===stopped2;
 await page.evaluate(()=>window.__PRESENCE__.pause(false));await page.evaluate(async()=>{for(let i=0;i<125;i++)await new Promise(requestAnimationFrame);});await page.evaluate(()=>window.__PRESENCE__.pause());checks.resume=(await inspect()).time>stopped;snapshots.push({timing:true,...await inspect()});
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.__PRESENCE__.step(0));await shot('portrait');await page.click('#help-open');await shot('help-portrait');
 if(Object.values(checks).some(v=>!v))throw Error('Failed checks: '+JSON.stringify(checks));
 if(errors.length||external.length)throw Error('Browser/network failures');completed=true;
}catch(e){failure=String(e);throw e;}finally{
 const hashes={};for(const name of ['src/presence/main.ts','src/presence/layer.ts','src/scene.ts'])hashes[name]=createHash('sha256').update(await readFile(new URL(`../../${name}`,import.meta.url))).digest('hex');
 await writeFile(new URL('results.json',dir),JSON.stringify({label,completed,failure,checks,errors,external,hashes,snapshots},null,2));await browser.close();
}

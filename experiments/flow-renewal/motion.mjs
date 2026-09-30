import {chromium} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const label=process.argv[2];if(!label||!/^[a-zA-Z0-9-]+$/.test(label))throw Error('Use a new output name');
const out=new URL(`./${label}/`,import.meta.url);await mkdir(out,{recursive:false});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const records=[],errors=[],sourceSha256={};let completed=false,failure;
for(const name of ['field.ts','material.ts','preview.ts'])sourceSha256[name]=createHash('sha256').update(await readFile(new URL(`../../src/renewed-flow/${name}`,import.meta.url))).digest('hex');
try{
 for(const mode of ['renew','coordinates']){
  const context=await browser.newContext({viewport:{width:1280,height:900},deviceScaleFactor:1,recordVideo:{dir:out.pathname,size:{width:1280,height:900}}});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(`http://127.0.0.1:4192/src/renewed-flow/preview.html?paused=1&mode=${mode}`);
  await page.waitForFunction(()=>document.body.dataset.ready==='true');
  await page.evaluate(()=>window.__renew.advance(45));
  const start=await page.evaluate(()=>window.__renew.inspect());
  const wallStart=Date.now();await page.evaluate(()=>window.__renew.pause(false));
  await page.waitForTimeout(18000);await page.evaluate(()=>window.__renew.pause());
  const end=await page.evaluate(()=>window.__renew.inspect()),wallMs=Date.now()-wallStart;
  await page.locator('canvas').screenshot({path:new URL(`${mode}-end.png`,out).pathname});
  const video=page.video();await context.close();
  records.push({mode,video:(await video.path()).split('/').at(-1),start,end,wallMs});
 }
 if(errors.length)throw Error('Browser reported an error');completed=true;
}catch(e){failure='Video capture did not complete; inspect the local command output.';throw e;}finally{
 await writeFile(new URL('results.json',out),JSON.stringify({completed,failure,sourceSha256,scope:'Each video begins with a fixed-step jump from 0 to 45 seconds, followed by approximately 18 seconds of real-time motion. Not a 30-minute test. Recording overhead is present.',records,errors},null,2),{flag:'wx'});await browser.close();
}
if(errors.length)throw Error(errors.join('\n'));

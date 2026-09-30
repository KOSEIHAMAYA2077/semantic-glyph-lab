import {chromium} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const label=process.argv[2]??'long-run-v1';if(!/^[a-zA-Z0-9-]+$/.test(label))throw Error('Use a new simple output name');
const out=new URL(`./${label}/`,import.meta.url);await mkdir(out,{recursive:false});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});page.setDefaultTimeout(120000);
const errors=[],consoleErrors=[],externalRequests=[],snapshots=[];let completed=false,failure;
page.on('pageerror',error=>errors.push(String(error)));page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
page.on('request',request=>{if(!/^(http:\/\/127\.0\.0\.1:4190\/|data:|blob:)/.test(request.url()))externalRequests.push(request.url());});
const startedAt=new Date().toISOString(),sourceSha256={};
for(const name of ['field.ts','material.ts','preview.ts'])sourceSha256[`src/fluid/${name}`]=createHash('sha256').update(await readFile(new URL(`../../src/fluid/${name}`,import.meta.url))).digest('hex');
try{
 await page.goto('http://127.0.0.1:4190/src/fluid/preview.html?paused=1&force=.4&interpolation=manual&transport=first&shape=sphere');
 await page.waitForFunction(()=>document.body.dataset.ready==='true');await page.evaluate(()=>{window.__fluid.pause();window.__fluid.reset();});
 let at=0;
 for(const target of [120,300,600]){
  while(at<target){const seconds=Math.min(120,target-at);await page.evaluate(seconds=>window.__fluid.advance(seconds),seconds);at+=seconds;}
  const state=await page.evaluate(()=>window.__fluid.inspect());snapshots.push({requestedTime:target,...state});
  await page.locator('canvas').screenshot({path:new URL(`sphere-fluid-t${target}.png`,out).pathname});
  console.log(JSON.stringify({target,simulation:state.simulation}));
  if(!state.simulation.finite||state.simulation.gpuError||state.gpuError)throw Error('Non-finite state or GL error');
 }
 completed=true;
}catch(error){failure=String(error);throw error;}finally{
 await writeFile(new URL('results.json',out),JSON.stringify({startedAt,finishedAt:new Date().toISOString(),completed,failure,sourceSha256,scope:'Fixed-step numerical/visual experiment; other UI checks may run concurrently. Not an FPS benchmark.',snapshots,errors,consoleErrors,externalRequests},null,2),{flag:'wx'});await browser.close();
}
if(errors.length||consoleErrors.length||externalRequests.length)throw Error(JSON.stringify({errors,consoleErrors,externalRequests}));

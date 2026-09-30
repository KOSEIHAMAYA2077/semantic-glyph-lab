import {chromium} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const label=process.argv[2];if(!label||!/^[a-zA-Z0-9-]+$/.test(label))throw Error('Use a new output name');
const out=new URL(`./${label}/`,import.meta.url);await mkdir(out,{recursive:false});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage(),checks=[],errors=[],sourceSha256={};
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
for(const name of ['field.ts','preview.ts','renewal.ts','material.ts'])sourceSha256[name]=createHash('sha256').update(await readFile(new URL(`../../src/renewed-flow/${name}`,import.meta.url))).digest('hex');
let completed=false,failure;
try{
 for(const transport of ['first','corrected']){
  await page.goto(`http://127.0.0.1:4192/src/renewed-flow/preview.html?paused=1&transport=${transport}`);
  await page.waitForFunction(()=>document.body.dataset.ready==='true');
  const state=await page.evaluate(()=>window.__renew.advance(2));
  const equality=state.renewal.maps.every(m=>JSON.stringify(m)===JSON.stringify(state.renewal.baseline));
  if(!equality)throw Error('Transport differs before first reset');
  const probe=await page.evaluate(()=>{window.__renew.probe();return window.__renew.inspect();});
  if(probe.steps!==0||probe.simulation.steps!==0||probe.renewal.resets.some(x=>x!==0))throw Error('Probe leaves inconsistent clock');
  checks.push({transport,beforeFirstResetMapMetricsMatch:equality,probeResetsBothClocks:true});
 }
 if(errors.length)throw Error(errors.join('\n'));completed=true;
}catch(e){failure=String(e);throw e;}finally{
 await writeFile(new URL('results.json',out),JSON.stringify({completed,failure,sourceSha256,checks,errors},null,2),{flag:'wx'});await browser.close();
}

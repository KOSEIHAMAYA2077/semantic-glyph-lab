import {chromium} from '@playwright/test';
import {readFile,mkdir,writeFile,access} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const run=process.argv[2];if(!run||!/^[a-zA-Z0-9-]+$/.test(run))throw new Error('Unique run name required');
const root=process.cwd(),dir=path.join(root,'experiments/end-to-end',run);
const manifest=JSON.parse(await readFile(path.join(root,'public/end-to-end-models',run,'manifest.json'),'utf8'));
const out=path.join(dir,'screens');await mkdir(out);
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page=await browser.newPage({viewport:{width:1560,height:1040},deviceScaleFactor:1});
const errors=[],remote=[];page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(!['127.0.0.1','localhost'].includes(new URL(r.url()).hostname))remote.push(r.url());});
const entries=[];
const sourceHashes={};
for(const file of ['src/scene.ts','src/letters.ts','src/surface-material.ts','src/body-motion.ts'])sourceHashes[file]=createHash('sha256').update(await readFile(path.join(root,file))).digest('hex');
try{
 for(const model of manifest.models){
  const url=new URL('http://127.0.0.1:4183/experiments/end-to-end/preview.html');url.searchParams.set('model',model.path);url.searchParams.set('label',model.label);
  await page.goto(url.href);await page.waitForFunction(()=>document.body.dataset.ready==='true');
  const state=await page.evaluate(()=>window.__E2E_COMPARE__.inspect());
  if(state.gpuError!==0)throw new Error('WebGL error');
  const filename=path.basename(model.path,'.glb')+'.png';await page.screenshot({path:path.join(out,filename)});
  entries.push({id:model.id,path:`experiments/end-to-end/${run}/screens/${filename}`,vertices:state.vertices,letters:state.count,gpuError:state.gpuError});
 }
 await writeFile(path.join(out,'verification.json'),JSON.stringify({date:'2026-09-30',sourceHashes,entries,errors,remote},null,2)+'\n',{flag:'wx'});
 if(errors.length||remote.length)throw new Error('Browser errors or nonlocal requests detected');
 console.log(`Captured ${entries.length} models, grey + text in three fixed views each`);
}finally{await browser.close();}

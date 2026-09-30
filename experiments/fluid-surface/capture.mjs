import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {projectReference,divergence,rms} from '../../src/fluid/operators.ts';

const label=process.argv[2]??'run-v1',smoke=process.argv.includes('--smoke');
const force=process.argv.find(a=>a.startsWith('--force='))?.slice(8)??'.4',transport=process.argv.includes('--corrected')?'corrected':'first';
const interpolation=process.argv.includes('--hardware')?'hardware':'manual';
const port=Number(process.argv.find(a=>a.startsWith('--port='))?.slice(7)??'4190');
if(!/^[a-zA-Z0-9-]+$/.test(label))throw Error('Use a new simple output name');
const out=new URL(`./${label}/`,import.meta.url);await mkdir(out,{recursive:false});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});
page.setDefaultTimeout(120000);
const pageErrors=[],consoleErrors=[],externalRequests=[],snapshots=[];
page.on('pageerror',error=>pageErrors.push(String(error)));
page.on('console',msg=>{if(msg.type()==='error')consoleErrors.push(msg.text());});
page.on('request',request=>{if(!request.url().startsWith(`http://127.0.0.1:${port}/`)&&!/^(blob:|data:)/.test(request.url()))externalRequests.push(request.url());});
let probe,determinism,pauseCheck,completed=false,failure;
try{
 await page.goto(`http://127.0.0.1:${port}/src/fluid/preview.html?paused=1&force=${encodeURIComponent(force)}&transport=${transport}&interpolation=${interpolation}`);
 await page.waitForFunction(()=>document.body.dataset.ready==='true');
 const rawProbe=await page.evaluate(()=>window.__fluid.probe());
 const {inputVelocity,outputVelocity,...summary}=rawProbe;
 const reference=projectReference(new Float32Array(inputVelocity),128,100),gpu=new Float32Array(outputVelocity);
 let maxDifference=0;for(let i=0;i<gpu.length;i++)if(i%4<2)maxDifference=Math.max(maxDifference,Math.abs(gpu[i]-reference.velocity[i]));
 probe={...summary,cpuPostDivergenceRms:rms(divergence(reference.velocity,128)),cpuGpuVelocityMaxDifference:maxDifference};
 console.log('projection',JSON.stringify(probe));
 if(!probe.finite||probe.gpuError||probe.divergenceRatio>.04||maxDifference>2e-5)throw Error('Projection diagnostic failed');
 await page.evaluate(()=>window.__fluid.advance(1));const sample1=await page.evaluate(()=>window.__fluid.sample());
 await page.evaluate(()=>window.__fluid.reset());await page.evaluate(()=>window.__fluid.advance(1));const sample2=await page.evaluate(()=>window.__fluid.sample());
 determinism={identicalSamples:JSON.stringify(sample1)===JSON.stringify(sample2),sampleValues:sample1.velocity.length+sample1.displacement.length};
 const before=await page.evaluate(()=>window.__fluid.inspect().steps);await page.waitForTimeout(250);const stopped=await page.evaluate(()=>window.__fluid.inspect().steps);
 await page.evaluate(()=>window.__fluid.pause(false));await page.evaluate(async()=>{for(let i=0;i<12;i++)await new Promise(requestAnimationFrame);});await page.evaluate(()=>window.__fluid.pause());
 pauseCheck={before,whilePaused:stopped,afterResume:await page.evaluate(()=>window.__fluid.inspect().steps)};
 if(!determinism.identicalSamples||before!==stopped||pauseCheck.afterResume<=stopped)throw Error('Clock/seed diagnostic failed');
 for(const shape of smoke?['sphere']:['sphere','vase','can']){
  await page.evaluate(shape=>window.__fluid.choose(shape),shape);
  for(const mode of smoke?['fluid']:['sin','fluid']){
   await page.evaluate(mode=>window.__fluid.mode(mode),mode);
   let prior=0;
   for(const target of [0,20,60]){
    if(target>prior)await page.evaluate(seconds=>window.__fluid.advance(seconds),target-prior);prior=target;
    const state=await page.evaluate(()=>window.__fluid.inspect());snapshots.push({requestedTime:target,...state});
    await page.locator('canvas').screenshot({path:new URL(`${shape}-${mode}-t${target}.png`,out).pathname});
    console.log('snapshot',JSON.stringify({shape,mode,target,simulation:state.simulation}));
    if(state.gpuError||!state.simulation.finite||state.simulation.gpuError)throw Error('Numerical/GL diagnostic failed');
   }
   if(!smoke){
    await page.evaluate(()=>window.__fluid.pause(false));
    const timing=await page.evaluate(async()=>{
     for(let i=0;i<30;i++)await new Promise(requestAnimationFrame);
     const stamps=[];for(let i=0;i<241;i++)stamps.push(await new Promise(requestAnimationFrame));
     window.__fluid.pause();const intervals=stamps.slice(1).map((n,i)=>n-stamps[i]),sorted=[...intervals].sort((a,b)=>a-b),q=p=>sorted[Math.ceil(sorted.length*p)-1];
     return{frames:intervals.length,intervals,medianMs:q(.5),p95Ms:q(.95),p99Ms:q(.99),meanMs:intervals.reduce((a,b)=>a+b,0)/intervals.length};
    });
    snapshots.push({benchmark:true,...await page.evaluate(()=>window.__fluid.inspect()),timing});
    console.log('timing',JSON.stringify({shape,mode,medianMs:timing.medianMs,p95Ms:timing.p95Ms}));
   }
  }
 }
 completed=true;
}catch(error){failure=String(error);throw error;}finally{
 await writeFile(new URL('results.json',out),JSON.stringify({label,smoke,port,completed,failure,probe,determinism,pauseCheck,snapshots,pageErrors,consoleErrors,externalRequests},null,2),{flag:'wx'});await browser.close();
}
if(pageErrors.length||consoleErrors.length||externalRequests.length)throw Error(JSON.stringify({pageErrors,consoleErrors,externalRequests}));

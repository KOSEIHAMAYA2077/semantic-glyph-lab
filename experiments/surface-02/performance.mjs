import { chromium } from 'playwright';
import { mkdir,writeFile } from 'node:fs/promises';
const out=process.argv[2]??'experiments/surface-02/performance-v1';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const cases=[['sphere',null],['shap-e-vase','/generated/shap-e-vase-outer-shell-v1.glb'],['triposr-horse','/reconstructed/mps128-y-up/triposr-horse-y-up.glb']];
const results=[];
try{
 for(const [name,path] of cases){
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:4183/');
  await page.locator('#input-open').click();await page.locator('#text').fill('白い球体の表面に、これまでの文章を残して流れを確かめる。');await page.locator('#text').press('Enter');await page.locator('#entry').waitFor({state:'hidden'});
  if(path){await page.locator('#compare-open').click();await page.locator('#generated').selectOption(path);await page.locator('#load-generated').click();await page.locator('#panel').waitFor({state:'hidden'});}
  for(const mode of ['texture','advection']){
   await page.locator('#compare-open').click();await page.locator('#rotation').uncheck();
   const begin=performance.now();await page.locator('#render-mode').selectOption(mode);const switchMs=performance.now()-begin;await page.locator('#close-panel').click();
   const intervals=await page.evaluate(()=>new Promise(resolve=>{const samples=[];let last=performance.now(),warmup=30;function sample(now){if(warmup--<0)samples.push(now-last);last=now;if(samples.length<240)requestAnimationFrame(sample);else resolve(samples);}requestAnimationFrame(sample);}));
   const sorted=[...intervals].sort((a,b)=>a-b),state=await page.evaluate(()=>window.__SEMANTIC_GLYPH__.inspect());
   await page.screenshot({path:`${out}/${name}-${mode}.png`});
   results.push({name,mode,particles:mode==='advection'?4096:undefined,frames:intervals.length,medianIntervalMs:sorted[120],p95IntervalMs:sorted[228],maxIntervalMs:sorted.at(-1),switchMs,vertices:state.vertices,gpuError:state.gpuError,errors});
  }
  await page.close();
 }
 await writeFile(`${out}/results.json`,JSON.stringify({date:new Date().toISOString(),browser:await browser.version(),viewport:[1280,900],note:'rAF intervals in headless Chrome on this Mac; switch includes browser-control overhead; not isolated GPU timings',results},null,2));console.log(JSON.stringify(results));
}finally{await browser.close();}

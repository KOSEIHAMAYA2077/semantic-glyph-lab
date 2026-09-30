import { chromium } from 'playwright';
import { mkdir,writeFile } from 'node:fs/promises';
const out='experiments/surface-02/live-composition-v1';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4183/');
  await page.locator('#compare-open').click();await page.locator('#method').selectOption('compose');await page.locator('#close-panel').click();
  await page.locator('#input-open').click();await page.locator('#text').fill('花瓶から木が生えている');
  const pending=page.waitForResponse(r=>r.url().endsWith('/compose-api/compose'),{timeout:180000});
  await page.locator('#text').press('Enter');
  const response=await pending;const result=await response.json();
  await page.waitForFunction(()=>!window.__SEMANTIC_GLYPH__.inspect().busy,{},{timeout:180000});
  const state=await page.evaluate(()=>window.__SEMANTIC_GLYPH__.inspect());
  if(!response.ok() || !state.loaded.startsWith('composition:') || errors.length) throw new Error(JSON.stringify({status:response.status(),errors,state}));
  await page.evaluate(()=>window.__SEMANTIC_GLYPH__.step(10));
  await page.screenshot({path:`${out}/surface.png`});
  await writeFile(`${out}/result.json`,JSON.stringify({syntheticInput:'花瓶から木が生えている',result,vertices:state.vertices,errors},null,2));
  console.log(JSON.stringify({loaded:state.loaded,parts:result.parts.length,elapsedMs:result.elapsedMs,errors}));
} finally {await browser.close();}

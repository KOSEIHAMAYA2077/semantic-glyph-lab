import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const capture = 'experiments/surface-01/screens';
mkdirSync(capture, { recursive:true });
const inspect = (page:Page) => page.evaluate(()=> (window as any).__SEMANTIC_GLYPH__.inspect());
const start = async(page:Page) => { await page.goto('/'); await page.waitForFunction(()=>Boolean((window as any).__SEMANTIC_GLYPH__)); };
const feed = async(page:Page,text:string) => { await page.locator('#input-open').click(); await page.locator('#text').fill(text); await page.locator('#text').press('Enter'); await expect(page.locator('#entry')).toBeHidden(); };
const rules = async(page:Page) => { await page.locator('#compare-open').click(); await page.locator('#method').selectOption('rules'); await page.locator('#close-panel').click(); };

test('形と属性: 花瓶を保ったまま四角くし、文字は蓄積する',async({page})=>{
  const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
  await start(page); await rules(page); await feed(page,'花瓶の表面にことばを流す。');
  expect((await inspect(page)).spec.object).toBe('vase');
  await page.evaluate(()=>{(window as any).__SEMANTIC_GLYPH__.step(10);});
  await page.screenshot({path:`${capture}/vase.png`});
  const a = await inspect(page);
  await feed(page,'四角くねじれた');
  await page.evaluate(()=>{(window as any).__SEMANTIC_GLYPH__.step(10);});
  const b = await inspect(page);
  expect(b.spec).toMatchObject({object:'vase',squareness:1}); expect(b.spec.twist).toBeGreaterThan(.5);
  expect(b.count).toBeGreaterThan(a.count); expect(b.letters.slice(0,a.count)).toEqual(a.letters);
  expect(b.vertices).toBe(a.vertices); expect(b.bounds).not.toEqual(a.bounds);
  await page.screenshot({path:`${capture}/square-twisted-vase.png`});
  expect(errors).toEqual([]);
});

test('剣と球: 面を覆う文字の画像、指定した色だけを残す',async({page})=>{
  await start(page); await rules(page); await feed(page,'白い剣');
  await page.evaluate(()=>{(window as any).__SEMANTIC_GLYPH__.step(10);});
  await page.screenshot({path:`${capture}/sword.png`});
  const a = await inspect(page); expect(a.spec.object).toBe('sword');
  await feed(page,'赤い球体');
  await page.evaluate(()=>{(window as any).__SEMANTIC_GLYPH__.step(10);});
  const b = await inspect(page); expect(b.spec.object).toBe('sphere');
  expect(b.letters.slice(0,a.count)).toEqual(a.letters); expect(b.letters.at(-1).ink).toMatch(/^#[a-f0-9]{6}$/); expect(b.letters.at(-1).auto).toBe(false); expect(b.letters.at(-1).ink).not.toBe(a.letters.at(-1).ink);
  await page.screenshot({path:`${capture}/sphere.png`});
});

test('停止中は描画も時間も変わらず、再開後は流れる',async({page})=>{
  await start(page); await rules(page); await feed(page,'球体に、文章、abc、123。');
  await page.locator('#compare-open').click(); await page.locator('#rotation').uncheck(); await page.locator('#close-panel').click();
  await page.locator('#pause').click();
  const a = await inspect(page), pixelsA = await page.locator('canvas').screenshot();
  await page.waitForTimeout(500);
  const b = await inspect(page), pixelsB = await page.locator('canvas').screenshot();
  expect(b.time).toBe(a.time); expect(pixelsB.equals(pixelsA)).toBe(true);
  await page.locator('#pause').click(); await page.waitForTimeout(1100);
  const pixelsC = await page.locator('canvas').screenshot(); expect(pixelsC.equals(pixelsA)).toBe(false);
});

test('IMEの確定Enterは送信しない。空白は材料にしない',async({page})=>{
  await start(page); await page.locator('#input-open').click();
  const input=page.locator('#text'); await input.dispatchEvent('compositionstart'); await input.fill('花瓶');
  await input.press('Enter'); expect((await inspect(page)).count).toBe(1);
  await input.dispatchEvent('compositionend'); await input.press('Enter');
  expect((await inspect(page)).count).toBe(1); await page.waitForTimeout(100); await input.press('Enter');
  await expect.poll(async()=> (await inspect(page)).count).toBe(3);
});

test('画面が狭くても入力と比較を操作できる',async({page})=>{
  await page.setViewportSize({width:390,height:844}); await start(page); await rules(page); await feed(page,'細長い剣');
  await page.locator('#compare-open').click();
  const box=await page.locator('#panel').boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x+box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({path:`${capture}/mobile-comparison.png`});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
});

test('実際の意味APIで、物体名のない文章から椅子を選ぶ',async({page})=>{
  const remote:string[]=[]; page.on('request',r=>{if(!new URL(r.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/)) remote.push(r.url());});
  await start(page); await expect.poll(async()=> (await inspect(page)).apiAvailable).toBe(true);
  await feed(page,'腰を下ろして休めるもの');
  const a=await inspect(page); expect(a.spec.object).toBe('chair'); expect(a.last.source).toBe('embedding');
  await feed(page,'四角く、細長い'); const b=await inspect(page);
  expect(b.spec).toMatchObject({object:'chair',squareness:1}); expect(b.spec.elongation).toBeGreaterThan(1.5);
  expect(remote).toEqual([]);
});

test('解釈待ちの追加入力と通信失敗で本文を失わない',async({page})=>{
  await start(page); await expect.poll(async()=> (await inspect(page)).apiAvailable).toBe(true);
  await page.route('**/api/interpret',async route=>{await new Promise(r=>setTimeout(r,250)); await route.fulfill({status:503,body:'{}'});});
  await page.locator('#input-open').click(); await page.locator('#text').fill('未送信の文章'); await page.locator('#text').press('Enter');
  await expect(page.locator('#text')).toBeDisabled();
  await expect(page.locator('#text')).toBeEnabled(); await expect(page.locator('#text')).toHaveValue('未送信の文章');
  expect((await inspect(page)).count).toBe(1); await expect(page.locator('#status')).toContainText('入力は残っています');
});

test('既存OBJの面にも同じ文字を流せる',async({page})=>{
  await start(page); await feed(page,'木の表面に文字を流す');
  await page.locator('#compare-open').click(); await page.locator('#asset').selectOption('tree_oak'); await page.locator('#load-asset').click();
  await expect.poll(async()=> (await inspect(page)).loaded).toBe('/models/kenney/tree_oak.obj');
  expect((await inspect(page)).vertices).toBe(588);
  await page.evaluate(()=>{(window as any).__SEMANTIC_GLYPH__.step(10);});
  await page.screenshot({path:`${capture}/kenney-tree.png`});
});

test('Shap-Eの生成GLBに文字テクスチャを適用する',async({page})=>{
  await start(page); await feed(page,'花瓶を言葉で満たす');
  await page.locator('#compare-open').click(); await page.locator('#generated').selectOption('/generated/shap-e-vase-mps32-grid128-refined.glb');
  await page.locator('#load-generated').click();
  await expect.poll(async()=> (await inspect(page)).loaded).toContain('shap-e-vase');
  await page.evaluate(()=>{(window as any).__SEMANTIC_GLYPH__.step(10);});
  expect((await inspect(page)).vertices).toBeGreaterThan(1000);
  await page.screenshot({path:`${capture}/shap-e-vase.png`});
});

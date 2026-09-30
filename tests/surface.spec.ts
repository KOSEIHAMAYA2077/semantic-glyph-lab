import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const capture = `.local/browser-tests/${Date.now()}-${process.pid}`;
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

test('生成したGLBへの属性追記で物体を取り替えない',async({page})=>{
  await start(page); await expect.poll(async()=> (await inspect(page)).apiAvailable).toBe(true);
  await feed(page,'ことばを入れる'); await page.locator('#compare-open').click();
  await page.locator('#generated').selectOption('/generated/shap-e-vase-outer-shell-v1.glb'); await page.locator('#load-generated').click();
  await expect.poll(async()=> (await inspect(page)).loaded).toContain('vase-outer');
  const before=await inspect(page); await feed(page,'四角く、ねじれた');
  const after=await inspect(page); expect(after.loaded).toBe(before.loaded); expect(after.vertices).toBe(before.vertices);
  expect(after.bounds).not.toEqual(before.bounds); expect(after.spec.squareness).toBe(1);
  await page.evaluate(()=>{(window as any).__SEMANTIC_GLYPH__.step(10);});
  await page.screenshot({path:`${capture}/shap-e-vase-modified.png`});
});

test('生成待ちに方式を変えても届いた部品を球へ取り替えない',async({page})=>{
  await start(page); await page.route('**/compose-api/compose',async route=>{
    await new Promise(r=>setTimeout(r,500)); await route.fulfill({contentType:'application/json',body:JSON.stringify({label:'synthetic-test',parts:[{kind:'torus',position:[0,0,0],scale:[1,1,1],rotation:[0,0,0]}]})});
  });
  await page.locator('#compare-open').click(); await page.locator('#method').selectOption('compose'); await page.locator('#close-panel').click();
  await page.locator('#input-open').click(); await page.locator('#text').fill('輪'); await page.locator('#text').press('Enter');
  await page.locator('#compare-open').click(); await page.locator('#method').selectOption('semantic');
  await expect.poll(async()=> (await inspect(page)).loaded).toBe('composition:synthetic-test');
  await expect.poll(async()=> (await inspect(page)).busy).toBe(false);
  expect((await inspect(page)).loaded).toBe('composition:synthetic-test');
});

test('蓄積上限を超える本文は切り捨てず入力に残す',async({page})=>{
  await start(page); await rules(page); await feed(page,'あ'.repeat(4000));
  await page.locator('#input-open').click(); await page.locator('#text').fill('い'.repeat(100)); await page.locator('#text').press('Enter');
  await expect(page.locator('#text')).toHaveValue('い'.repeat(100)); await expect(page.locator('#status')).toContainText('あと95字');
  expect((await inspect(page)).count).toBe(4001);
});

test('遅れた解釈は、後から選んだ素材を上書きしない',async({page})=>{
  await start(page); await expect.poll(async()=> (await inspect(page)).apiAvailable).toBe(true);
  await page.route('**/api/interpret',async route=>{ await new Promise(r=>setTimeout(r,900)); await route.continue(); });
  await page.locator('#input-open').click(); await page.locator('#text').fill('立方体'); await page.locator('#text').press('Enter');
  await page.locator('#compare-open').click(); await page.locator('#load-asset').click();
  await expect.poll(async()=> (await inspect(page)).loaded).toContain('tree_oak');
  await expect.poll(async()=> (await inspect(page)).busy).toBe(false);
  expect((await inspect(page)).loaded).toContain('tree_oak'); expect((await inspect(page)).count).toBe(1);
  await expect(page.locator('#text')).toHaveValue('立方体');
});

test('画像から復元した馬を同じ文字表面で表示する',async({page})=>{
  await start(page); await feed(page,'馬の表面を言葉が流れる');
  await page.locator('#compare-open').click(); await page.locator('#generated').selectOption('/reconstructed/mps128-y-up/triposr-horse-y-up.glb');
  await page.locator('#load-generated').click();await expect.poll(async()=> (await inspect(page)).loaded).toContain('triposr-horse');
  await page.evaluate(()=>(window as any).__SEMANTIC_GLYPH__.step(10));
  await page.screenshot({path:`${capture}/triposr-horse.png`});
});

test('文字帳が大きくなっても新しい色がGPUへ届く',async({page})=>{
  await start(page);await rules(page);await feed(page,'黄色い球体'+ 'あいうえお'.repeat(18));
  const result=await page.evaluate(()=>{
    const canvas=document.querySelector('canvas')!;const gl=canvas.getContext('webgl2')!;
    const pixels=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    let yellow=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>100&&pixels[i+1]>80&&pixels[i+2]<pixels[i+1]*.7)yellow++;
    return {error:gl.getError(),yellow};
  });
  expect(result.error).toBe(0);expect(result.yellow).toBeGreaterThan(500);
});

test('面を歩く文字: 流れと停止、属性、複数体と描画切替',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await start(page);await rules(page);await feed(page,'白い花瓶と文字');
  await page.locator('#compare-open').click();await page.locator('#rotation').uncheck();await page.locator('#render-mode').selectOption('advection');await page.locator('#close-panel').click();
  expect((await inspect(page)).renderMode).toBe('advection');
  const first=await page.locator('canvas').screenshot();await page.waitForTimeout(800);
  expect((await page.locator('canvas').screenshot()).equals(first)).toBe(false);
  await page.locator('#pause').click();const paused=await page.locator('canvas').screenshot();await page.waitForTimeout(300);
  expect((await page.locator('canvas').screenshot()).equals(paused)).toBe(true);
  await feed(page,'四角く、ねじれた');expect((await inspect(page)).spec.squareness).toBe(1);
  await feed(page,'球体を4個');expect((await inspect(page)).spec.count).toBe(4);
  await page.screenshot({path:`${capture}/advection-four-spheres.png`});
  await page.locator('#compare-open').click();await page.locator('#render-mode').selectOption('texture');await page.locator('#close-panel').click();
  expect((await inspect(page)).gpuError).toBe(0);expect(errors).toEqual([]);
});

test('ボタンのEnterは全体ショートカットに奪われない',async({page})=>{
  await start(page);await page.locator('#pause').focus();await page.keyboard.press('Enter');
  expect((await inspect(page)).paused).toBe(true);await expect(page.locator('#entry')).toBeHidden();
  await page.locator('#compare-open').focus();await page.keyboard.press('Enter');await expect(page.locator('#panel')).toBeVisible();
});

test('日本語の説明を英語へ渡し、元の日本語を表面に残す',async({page})=>{
  const {readFile}=await import('node:fs/promises');const glb=await readFile('public/generated/shap-e-vase-outer-shell-v1.glb');
  let descriptionRequest='',generationRequest='';await start(page);
  await page.route('**/description-api/describe',async route=>{descriptionRequest=route.request().postDataJSON().text;await route.fulfill({contentType:'application/json',body:JSON.stringify({text_en:'a blue vase'})});});
  await page.route('**/generate-api/generate',async route=>{generationRequest=route.request().postDataJSON().text;await route.fulfill({contentType:'model/gltf-binary',body:glb});});
  await page.locator('#compare-open').click();await page.locator('#method').selectOption('generate-ja');await page.locator('#close-panel').click();await feed(page,'青い花瓶');
  const state=await inspect(page);expect(descriptionRequest).toBe('青い花瓶');expect(generationRequest).toBe('a blue vase');expect(state.letters.slice(1).map((l:any)=>l.text).join('')).toBe('青い花瓶');expect(state.loaded).toMatch(/^blob:/);expect(state.letters.at(-1).auto).toBe(false);
});

test('説明を特定できない場合は生成せず原文を残す',async({page})=>{
  let generated=false;await start(page);
  await page.route('**/description-api/describe',route=>route.fulfill({status:422,contentType:'application/json',body:'{"error":"No concrete object"}'}));
  await page.route('**/generate-api/generate',route=>{generated=true;return route.abort();});
  await page.locator('#compare-open').click();await page.locator('#method').selectOption('generate-ja');await page.locator('#close-panel').click();
  await page.locator('#input-open').click();await page.locator('#text').fill('それでいい');await page.locator('#text').press('Enter');
  await expect(page.locator('#text')).toBeEnabled();await expect(page.locator('#text')).toHaveValue('それでいい');expect(generated).toBe(false);expect((await inspect(page)).count).toBe(1);
});

test('文章から画像を経て作った花瓶にも文字を流す',async({page})=>{
  await start(page);await feed(page,'言葉が面を覆う花瓶');await page.locator('#compare-open').click();
  await page.locator('#generated').selectOption('/text-image-models/mesh128-first/twisted-vase-y-up.glb');await page.locator('#load-generated').click();
  await expect.poll(async()=> (await inspect(page)).loaded).toContain('twisted-vase-y-up');
  await page.evaluate(()=>(window as any).__SEMANTIC_GLYPH__.step(10));
  await page.screenshot({path:`${capture}/text-image-twisted-vase.png`});expect((await inspect(page)).gpuError).toBe(0);
});

for(const mode of ['texture','advection']) test(`形の揺らぎ: ${mode}で流れを止めても形が動き、一時停止で止まる`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await start(page);await rules(page);await feed(page,'白い花瓶に文字を重ねる');
  await page.evaluate(()=>(window as any).__SEMANTIC_GLYPH__.step(10));
  await page.locator('#compare-open').click();await page.locator('#rotation').uncheck();
  await page.locator('#flow').fill('0');await page.locator('#render-mode').selectOption(mode);await page.locator('#body-motion').fill('1');await page.locator('#close-panel').click();
  await page.evaluate(()=>(window as any).__SEMANTIC_GLYPH__.step(1));
  const first=await page.locator('canvas').screenshot({path:`${capture}/body-${mode}-a.png`});
  await page.evaluate(()=>(window as any).__SEMANTIC_GLYPH__.step(8));
  const second=await page.locator('canvas').screenshot({path:`${capture}/body-${mode}-b.png`});
  expect(second.equals(first)).toBe(false);expect((await inspect(page)).bodyMotion).toBe(1);
  await page.waitForTimeout(350);expect((await page.locator('canvas').screenshot()).equals(second)).toBe(true);
  expect((await inspect(page)).gpuError).toBe(0);expect(errors).toEqual([]);
});

test('画像経由生成へ英語の説明を渡し、元の文章を表面に残す',async({page})=>{
  const {readFile}=await import('node:fs/promises');const glb=await readFile('public/text-image-models/mesh128-first/vase-y-up.glb');
  let generationRequest='';await start(page);
  await page.route('**/description-api/describe',route=>route.fulfill({contentType:'application/json',body:'{"text_en":"a simple ceramic vase"}'}));
  await page.route('**/image-api/generate',async route=>{generationRequest=route.request().postDataJSON().text;await route.fulfill({contentType:'model/gltf-binary',body:glb});});
  await page.locator('#compare-open').click();await page.locator('#method').selectOption('image-ja');await page.locator('#close-panel').click();await feed(page,'白い陶器の花瓶');
  const state=await inspect(page);expect(generationRequest).toBe('a simple ceramic vase');expect(state.letters.slice(1).map((l:any)=>l.text).join('')).toBe('白い陶器の花瓶');expect(state.loaded).toMatch(/^blob:/);expect(state.last.note).toContain('SDXL Turbo');
});

test('画像経由の前景抽出が失敗したら本文と元の形を残す',async({page})=>{
  await start(page);await rules(page);await feed(page,'青い剣');const before=await inspect(page);
  await page.route('**/description-api/describe',route=>route.fulfill({contentType:'application/json',body:'{"text_en":"a thin sword"}'}));
  await page.route('**/image-api/generate',route=>route.fulfill({status:422,contentType:'application/json',body:'{"error":"Foreground mask is empty"}'}));
  await page.locator('#compare-open').click();await page.locator('#method').selectOption('image-ja');await page.locator('#close-panel').click();
  await page.locator('#input-open').click();await page.locator('#text').fill('細い剣');await page.locator('#text').press('Enter');await expect(page.locator('#text')).toBeEnabled();
  await expect(page.locator('#text')).toHaveValue('細い剣');expect((await inspect(page)).spec).toEqual(before.spec);expect((await inspect(page)).count).toBe(before.count);
});

test('縦長画面でも、揺らぐ形の輪郭を画面内に収める',async({page})=>{
  await page.setViewportSize({width:390,height:844});await start(page);await rules(page);await feed(page,'白い球体');
  await page.locator('#compare-open').click();await page.locator('#rotation').uncheck();await page.locator('#flow').fill('0');await page.locator('#body-motion').fill('1');await page.locator('#close-panel').click();
  for(let i=0;i<4;i++){
    await page.evaluate(()=>(window as any).__SEMANTIC_GLYPH__.step(8));
    const visible=await page.evaluate(()=>{
      const c=document.querySelector('canvas')!,gl=c.getContext('webgl2')!,pixels=new Uint8Array(c.width*c.height*4);
      gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let left=c.width,right=0,count=0;
      for(let i=0;i<pixels.length;i+=4)if(Math.max(pixels[i],pixels[i+1],pixels[i+2])>30){const x=(i/4)%c.width;left=Math.min(left,x);right=Math.max(right,x);count++;}
      return {left,right,width:c.width,count,error:gl.getError()};
    });
    expect(visible.count).toBeGreaterThan(500);expect(visible.left).toBeGreaterThan(12);expect(visible.right).toBeLessThan(visible.width-12);expect(visible.error).toBe(0);
  }
});

test('同じ文章で生成した6形状を読み込み、元の文章を面に保つ',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await start(page);await rules(page);await feed(page,'白い文字の表面');const letters=(await inspect(page)).letters;
  for(const subject of ['sailboat','umbrella','watering-can'])for(const method of ['shap-e','image-triposr']){
    const path=`/end-to-end-models/paired-v1/${subject}-${method}.glb`;
    await page.locator('#compare-open').click();await page.locator('#generated').selectOption(path);await page.locator('#load-generated').click();
    await expect.poll(async()=> (await inspect(page)).loaded).toBe(path);
    await page.evaluate(()=>(window as any).__SEMANTIC_GLYPH__.step(10));
    expect((await inspect(page)).letters).toEqual(letters);expect((await inspect(page)).gpuError).toBe(0);
  }
  await page.screenshot({path:`${capture}/paired-watering-can.png`});
  const before=await inspect(page);await feed(page,'四角く');
  const after=await inspect(page);expect(after.loaded).toBe(before.loaded);expect(after.vertices).toBe(before.vertices);expect(after.bounds).not.toEqual(before.bounds);expect(after.spec.squareness).toBe(1);
  expect(errors).toEqual([]);
});

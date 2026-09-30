import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const capture = `.local/fluid-browser/${Date.now()}-${process.pid}`;
mkdirSync(capture, { recursive: true });
const inspect = (page: Page) => page.evaluate(() => (window as any).__SEMANTIC_GLYPH__.inspect());
const start = async (page: Page) => {
  await page.route('**/api/health', route => route.fulfill({ contentType: 'application/json', body: '{"semanticReady":false}' }));
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__SEMANTIC_GLYPH__));
  await page.locator('#compare-open').click();
  await page.locator('#method').selectOption('rules');
  await page.locator('#rotation').uncheck();
  await page.locator('#close-panel').click();
};
const feed = async (page: Page, text: string) => {
  await page.locator('#input-open').click();
  await page.locator('#text').fill(text);
  await page.locator('#text').press('Enter');
  await expect(page.locator('#entry')).toBeHidden();
};
const mode = async (page: Page, value: string) => {
  await page.locator('#compare-open').click();
  await page.locator('#render-mode').selectOption(value);
  await page.locator('#close-panel').click();
};
const frames = async (page: Page, number = 6) => {
  const before = (await inspect(page)).frames;
  await page.waitForFunction(({ before, number }) => (window as any).__SEMANTIC_GLYPH__.inspect().frames >= before + number, { before, number });
};
const settleCamera = (page: Page) => page.evaluate(() => {
  const api = (window as any).__SEMANTIC_GLYPH__;
  for (let i = 0; i < 500; i++) api.step(0);
  api.pause(false);
});
// Read the active surface program, so an atlas resize must reach the actual GPU
// uniform rather than only change a JavaScript counter.
const uniform = (page: Page, name: string) => page.evaluate(name => {
  const gl = document.querySelector('canvas')!.getContext('webgl2')!;
  const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
  const location = program && gl.getUniformLocation(program, name);
  return program && location ? gl.getUniform(program, location) : null;
}, name);

test('fluid allocates lazily, evolves a finite field, and updates the surface atlas after new letters', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await start(page);
  expect((await inspect(page)).fluid).toBeNull();
  await feed(page, '白い球体');
  expect((await inspect(page)).fluid).toBeNull();
  await mode(page, 'fluid');
  await expect.poll(async () => (await inspect(page)).fluid?.steps ?? 0).toBeGreaterThan(6);
  await page.locator('#pause').click();
  expect((await inspect(page)).paused).toBe(true);
  expect(await uniform(page, 'grid')).toBe(8);
  const simulation = await page.evaluate(() => (window as any).__SEMANTIC_GLYPH__.inspectFluid());
  expect(simulation.size).toBe(128);
  expect(simulation.finite).toBe(true);
  expect(simulation.maxSpeedUVPerSecond).toBeGreaterThan(0);
  expect(simulation.maxDisplacementUV).toBeGreaterThan(0);
  expect(simulation.gpuError).toBe(0);
  const before = await inspect(page);
  const added = '赤い' + 'あいうえお'.repeat(16);
  await feed(page, added);
  await expect.poll(() => uniform(page, 'grid')).toBe(16);
  await page.locator('#pause').click();
  const after = await inspect(page);
  expect(after.count).toBe(before.count + added.length);
  expect(after.letters.slice(0, before.count)).toEqual(before.letters);
  expect(after.letters.slice(before.count).map((letter: { text: string }) => letter.text).join('')).toBe(added);
  expect(after.letters.slice(before.count).every((letter: { ink: string }) => letter.ink === '#ef6969')).toBe(true);
  expect(after.renderMode).toBe('fluid');
  expect(after.gpuError).toBe(0);
  await page.screenshot({ path: `${capture}/sphere-new-atlas.png` });
  expect(errors).toEqual([]);
});

test('pause and zero flow stop both solver advancement and surface motion', async ({ page }) => {
  await start(page);
  // Unchecking auto-rotation leaves OrbitControls' existing damping tail. Settle
  // that camera inertia at zero simulation time before testing texture motion.
  await settleCamera(page);
  await feed(page, '白い文字の球体');
  await mode(page, 'fluid');
  await expect.poll(async () => (await inspect(page)).fluid?.steps ?? 0).toBeGreaterThan(6);
  await page.locator('#pause').click();
  const paused = await inspect(page), pausedPixels = await page.locator('canvas').screenshot();
  await frames(page);
  expect((await inspect(page)).fluid).toEqual(paused.fluid);
  expect((await inspect(page)).time).toBe(paused.time);
  expect((await page.locator('canvas').screenshot()).equals(pausedPixels)).toBe(true);
  await page.locator('#compare-open').click();
  await page.locator('#flow').fill('0');
  await page.locator('#close-panel').click();
  await page.locator('#pause').click();
  const stopped = await inspect(page), stoppedPixels = await page.locator('canvas').screenshot();
  await frames(page);
  const after = await inspect(page);
  expect(after.paused).toBe(false);
  expect(after.time).toBeGreaterThan(stopped.time);
  expect(after.flow).toBe(0);
  expect(after.fluid).toEqual(stopped.fluid);
  expect((await page.locator('canvas').screenshot()).equals(stoppedPixels)).toBe(true);
  expect(after.gpuError).toBe(0);
});

test('inactive modes preserve the fluid field, and reset clears only its motion', async ({ page }) => {
  await start(page);
  await feed(page, '白い花瓶');
  await mode(page, 'fluid');
  await expect.poll(async () => (await inspect(page)).fluid?.steps ?? 0).toBeGreaterThan(6);
  for (const inactive of ['texture', 'advection']) {
    await mode(page, inactive);
    const stored = (await inspect(page)).fluid;
    await frames(page);
    expect((await inspect(page)).fluid).toEqual(stored);
    await page.locator('#compare-open').click();
    await expect(page.locator('#reset-fluid')).toBeHidden();
    await page.locator('#render-mode').selectOption('fluid');
    await expect(page.locator('#reset-fluid')).toBeVisible();
    await page.locator('#close-panel').click();
    await expect.poll(async () => (await inspect(page)).fluid.steps).toBeGreaterThan(stored.steps);
  }
  await page.locator('#pause').click();
  const before = await inspect(page);
  await page.locator('#compare-open').click();
  await page.locator('#reset-fluid').click();
  const reset = await inspect(page);
  expect(reset.fluid).toEqual({ steps: 0, time: 0 });
  expect(reset.letters).toEqual(before.letters);
  expect(reset.spec).toEqual(before.spec);
  expect(reset.loaded).toBe(before.loaded);
  expect(reset.vertices).toBe(before.vertices);
  expect(reset.bounds).toEqual(before.bounds);
  expect(reset.paused).toBe(true);
  expect(reset.gpuError).toBe(0);
  await page.locator('#close-panel').click();
  await page.locator('#pause').click();
  await expect.poll(async () => (await inspect(page)).fluid.steps).toBeGreaterThan(0);
});

test('fluid covers a generated GLB while imported deformation and body movement remain active', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await start(page);
  await settleCamera(page);
  await feed(page, '白い文字が巡る');
  const path = '/end-to-end-models/paired-v1/watering-can-image-triposr.glb';
  await page.locator('#compare-open').click();
  await expect(page.locator(`#generated option[value="${path}"]`)).toHaveCount(1);
  await page.locator('#generated').selectOption(path);
  await page.locator('#load-generated').click();
  await expect.poll(async () => (await inspect(page)).loaded).toBe(path);
  const before = await inspect(page);
  await mode(page, 'fluid');
  await feed(page, '四角く、ねじれた');
  const deformed = await inspect(page);
  expect(deformed.loaded).toBe(path);
  expect(deformed.vertices).toBe(before.vertices);
  expect(deformed.bounds).not.toEqual(before.bounds);
  expect(deformed.spec.squareness).toBe(1);
  expect(deformed.spec.twist).not.toBe(0);
  await page.locator('#compare-open').click();
  await page.locator('#flow').fill('0');
  await page.locator('#body-motion').fill('0.7');
  await page.locator('#close-panel').click();
  // Let automatically tinted text settle, then isolate the shared body shader
  // from the frozen fluid field and fixed camera.
  await page.evaluate(() => (window as any).__SEMANTIC_GLYPH__.step(10));
  const frozen = await inspect(page), first = await page.locator('canvas').screenshot();
  expect(await uniform(page, 'bodyMotion')).toBeCloseTo(.7);
  await page.evaluate(() => (window as any).__SEMANTIC_GLYPH__.step(3));
  const moved = await inspect(page);
  expect(moved.fluid).toEqual(frozen.fluid);
  expect(moved.letters).toEqual(frozen.letters);
  expect(moved.loaded).toBe(path);
  expect(moved.bodyMotion).toBe(.7);
  expect((await page.locator('canvas').screenshot()).equals(first)).toBe(false);
  expect(moved.gpuError).toBe(0);
  await page.screenshot({ path: `${capture}/generated-deformed-body.png` });
  expect(errors).toEqual([]);
});

for (const previousMode of ['texture', 'advection']) {
  test(`unsupported float targets keep the existing ${previousMode} display and input`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const getExtension = WebGL2RenderingContext.prototype.getExtension as (this: WebGL2RenderingContext, name: string) => unknown;
      Object.defineProperty(WebGL2RenderingContext.prototype, 'getExtension', { value: function (this: WebGL2RenderingContext, name: string) {
        if (name === 'EXT_color_buffer_float') return null;
        return getExtension.call(this, name);
      } });
    });
    await start(page);
    await feed(page, '白い球体');
    if (previousMode !== 'texture') await mode(page, previousMode);
    await page.locator('#pause').click();
    const before = await inspect(page);
    await page.locator('#compare-open').click();
    await page.locator('#render-mode').selectOption('fluid');
    await expect(page.locator('#render-mode')).toHaveValue(previousMode);
    await expect(page.locator('#render-note')).toContainText('現在の表示を保ちます');
    const after = await inspect(page);
    expect(after.renderMode).toBe(previousMode);
    expect(after.fluid).toBeNull();
    expect(after.letters).toEqual(before.letters);
    expect(after.spec).toEqual(before.spec);
    expect(after.vertices).toBe(before.vertices);
    expect(after.gpuError).toBe(0);
    await page.locator('#close-panel').click();
    await feed(page, '追加');
    expect((await inspect(page)).count).toBe(before.count + 2);
    expect(errors).toEqual([]);
  });
}

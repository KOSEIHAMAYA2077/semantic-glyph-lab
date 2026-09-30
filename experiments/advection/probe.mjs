import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const out = new URL('./run-v2/', import.meta.url);
await mkdir(out, { recursive: false });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage(), errors = [], results = [];
page.on('pageerror', error => errors.push(String(error)));
await page.goto('http://127.0.0.1:4183/src/advection/preview.html');
await page.waitForFunction(() => document.body.dataset.ready === 'true');
// Pause via the real UI; each subsequent comparison starts from identical seed.
await page.locator('#pause').click();
for (const shape of ['sphere', 'vase', 'generated', 'cube']) {
  await page.locator(`[data-shape="${shape}"]`).click();
  await page.waitForFunction(shape => document.body.dataset.ready === 'true' && window.__advection.inspect().shape === shape, shape);
  const start = await page.evaluate(() => window.__advection.inspect());
  const at30Seconds = await page.evaluate(() => window.__advection.step(30));
  const sizes = [];
  for (const size of [.04, .09, .17]) {
    await page.locator('#size').fill(String(size));
    const measured = await page.evaluate(() => window.__advection.inspect());
    await page.screenshot({ path: new URL(`${shape}-size-${String(size).slice(2)}.png`, out).pathname });
    sizes.push(measured);
  }
  await page.locator('#mesh').check();
  await page.screenshot({ path: new URL(`${shape}-size-17-with-body.png`, out).pathname });
  await page.locator('#mesh').uncheck();
  results.push({ shape, start, at30Seconds, sizes });
  console.log(shape, JSON.stringify({ stops: at30Seconds.iterationStops, boundary: at30Seconds.boundaryStops, sizes: sizes.map(s => [s.size, s.cornerDistanceMean, s.cornerDistanceMax]) }));
}
await page.locator('#pause').click();
await page.waitForTimeout(1200);
const resumed = await page.evaluate(() => window.__advection.inspect());
if (!(resumed.time > 30.5)) throw new Error('Resume UI did not advance time');
await writeFile(new URL('measurements.json', out), JSON.stringify({ environment: 'M5 Chrome, 1280x900, deviceScaleFactor 1. Paused UI, fixed 30-second advance from seed, identical state at each size. These runs measure geometry, not real-time performance. Surface crossing cap increased from 24 to 96; original implementation retained.', errors, resumedTime: resumed.time, results }, null, 2), { flag: 'wx' });
await browser.close();
if (errors.length) throw new Error(errors.join('\n'));

import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const runName = process.argv[2] ?? 'run-v1', flow = process.argv[3] ?? 'normalized';
if (!/^[a-z0-9-]+$/.test(runName) || !['normalized', 'stream'].includes(flow)) throw new Error('Invalid output name or flow mode');
const out = new URL(`./${runName}/`, import.meta.url);
await mkdir(out, { recursive: false });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(String(error)));
const results = [];
for (const shape of ['sphere', 'vase', 'generated', 'cube']) {
  await page.goto(`http://127.0.0.1:4183/src/advection/preview.html?shape=${shape}&flow=${flow}`);
  await page.waitForFunction(() => document.body.dataset.ready === 'true', { timeout: 60000 });
  await page.waitForTimeout(12000);
  const measured = await page.evaluate(() => { const api = window.__advection; api.pause(true); return api.inspect(); });
  await page.screenshot({ path: new URL(`${shape}-front.png`, out).pathname });
  // Genuine OrbitControls input on the rendered canvas, in addition to metrics.
  await page.mouse.move(660, 440); await page.mouse.down(); await page.mouse.move(935, 470, { steps: 16 }); await page.mouse.up();
  await page.waitForTimeout(700);
  await page.screenshot({ path: new URL(`${shape}-rotated.png`, out).pathname });
  const before = await page.evaluate(() => window.__advection.sample());
  const advanced = await page.evaluate(() => window.__advection.step(10));
  const after = await page.evaluate(() => window.__advection.sample());
  await page.screenshot({ path: new URL(`${shape}-later.png`, out).pathname });
  const displacement = before.map((p, i) => Math.hypot(...p.position.map((x, j) => x - after[i].position[j])));
  results.push({ measured, advanced, sampleDisplacementsAfter10Seconds: displacement });
  console.log(shape, JSON.stringify(measured));
}
await writeFile(new URL('measurements.json', out), JSON.stringify({ environment: 'headless Chrome, 1280x900, deviceScaleFactor 1; real 12-second RAF observation per shape plus deterministic 10-second advance; sparse nearest-distance queries excluded from frame timing', errors, results }, null, 2), { flag: 'wx' });
await browser.close();
if (errors.length) throw new Error(errors.join('\n'));

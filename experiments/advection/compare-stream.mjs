import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const out = new URL('./run-v3/', import.meta.url); await mkdir(out, { recursive: false });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const errors = [], results = []; page.on('pageerror', e => errors.push(String(e)));
for (const flow of ['normalized', 'stream']) {
  await page.goto(`http://127.0.0.1:4183/src/advection/preview.html?flow=${flow}`);
  await page.waitForFunction(() => document.body.dataset.ready === 'true'); await page.locator('#pause').click();
  for (const shape of ['sphere', 'vase', 'generated', 'cube']) {
    await page.locator(`[data-shape="${shape}"]`).click();
    await page.waitForFunction(shape => document.body.dataset.ready === 'true' && window.__advection.inspect().shape === shape, shape);
    const initial = await page.evaluate(() => window.__advection.inspect());
    const at30 = await page.evaluate(() => window.__advection.step(30));
    await page.screenshot({ path: new URL(`${flow}-${shape}-30.png`, out).pathname });
    const at60 = await page.evaluate(() => window.__advection.step(30));
    await page.screenshot({ path: new URL(`${flow}-${shape}-60.png`, out).pathname });
    const totalVariation = after => initial.heightBins.reduce((sum, n, i) => sum + Math.abs(n - after.heightBins[i]), 0) / (2 * initial.count);
    const variation30 = totalVariation(at30), variation60 = totalVariation(at60);
    results.push({ flow, shape, initial, at30, at60, variation30, variation60 });
    console.log(flow, shape, JSON.stringify({ variation30, variation60, stops: at60.iterationStops, meanPath: at60.meanPathLength, bins: at60.heightBins }));
  }
}
await writeFile(new URL('measurements.json', out), JSON.stringify({ environment: 'M5 Chrome, 1280x900; each pair uses identical seeded centers and 3600 fixed 1/60-second steps. Variation is total variation of height-bin counts relative to initial sample, not a whole-surface density metric. Stream field speeds are not normalized, so mean path length is reported too.', errors, results }, null, 2), { flag: 'wx' });
await browser.close(); if (errors.length) throw new Error(errors.join('\n'));

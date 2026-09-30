import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

const capture = `.local/retrieval-browser/${Date.now()}-${process.pid}`;
mkdirSync(capture, { recursive: true });
const manifest = JSON.parse(readFileSync('public/retrieval-models/manifest.json', 'utf8'));
const assets: { id: string; name: string; path: string; source: string }[] = manifest.models.map(
  ({ id, name, path, source }: { id: string; name: string; path: string; source: string }) => ({ id, name, path, source }),
);
const [vase, wateringCan, saber] = assets;
const ranking = (ordered = assets) => ({
  candidates: ordered.map((asset, index) => ({ ...asset, score: .99 - index * .1 })),
  catalogCount: ordered.length,
  elapsedMs: 2,
});
const inspect = (page: Page) => page.evaluate(() => (window as any).__SEMANTIC_GLYPH__.inspect());
const textOf = (state: any) => state.letters.map((letter: { text: string }) => letter.text).join('');
const start = async (page: Page) => {
  await page.route('**/api/health', route => route.fulfill({ contentType: 'application/json', body: '{"semanticReady":false}' }));
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__SEMANTIC_GLYPH__));
  await chooseMethod(page, 'retrieve');
};
const chooseMethod = async (page: Page, method: string) => {
  await page.locator('#compare-open').click();
  await page.locator('#method').selectOption(method);
  await page.locator('#close-panel').click();
};
const feed = async (page: Page, text: string) => {
  await page.locator('#input-open').click();
  await page.locator('#text').fill(text);
  await page.locator('#text').press('Enter');
  await expect(page.locator('#entry')).toBeHidden();
};
const loadManual = async (page: Page, path: string) => {
  await page.locator('#compare-open').click();
  await expect(page.locator(`#generated option[value="${path}"]`)).toHaveCount(1);
  await page.locator('#generated').selectOption(path);
  await page.locator('#load-generated').click();
  await expect.poll(async () => (await inspect(page)).loaded).toBe(path);
  await expect(page.locator('#panel')).toBeHidden();
};
const sameShape = (after: any, before: any) => {
  expect(after.loaded).toBe(before.loaded);
  expect(after.spec).toEqual(before.spec);
  expect(after.vertices).toBe(before.vertices);
  expect(after.bounds).toEqual(before.bounds);
};
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};

test('retrieval appends once, waits for a choice, and loads each real local GLB without appending again', async ({ page }) => {
  const errors: string[] = [], requests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/retrieval-api/search', route => {
    requests.push(route.request().postDataJSON().text);
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(ranking()) });
  });
  await start(page);
  const phrases = ['青い陶器の花瓶', '長い注ぎ口が付いたじょうろ', '曲がった刃の剣'];
  for (const [index, asset] of assets.entries()) {
    const before = await inspect(page);
    await feed(page, phrases[index]);
    const waiting = await inspect(page);
    sameShape(waiting, before);
    expect(textOf(waiting)).toBe(textOf(before) + phrases[index]);
    expect(waiting.letters.slice(0, before.count)).toEqual(before.letters);
    await expect(page.locator('#asset-choices')).toBeVisible();
    await expect(page.locator('#asset-buttons button[data-asset-id]')).toHaveCount(3);
    await expect(page.locator('#asset-buttons').getByRole('button', { name: 'そのまま', exact: true })).toBeVisible();
    if (index === 0) await page.screenshot({ path: `${capture}/candidates.png` });
    await page.locator(`#asset-buttons button[data-asset-id="${asset.id}"]`).click();
    await expect.poll(async () => (await inspect(page)).loaded).toBe(asset.path);
    await expect.poll(async () => (await inspect(page)).busy).toBe(false);
    const selected = await inspect(page);
    expect(selected.letters).toEqual(waiting.letters);
    expect(selected.vertices).toBeGreaterThan(1000);
    expect(selected.last.source).toBe('retrieved');
    expect(selected.gpuError).toBe(0);
    await expect(page.locator('#asset-choices')).toBeHidden();
    if (index === 1) {
      await page.evaluate(() => (window as any).__SEMANTIC_GLYPH__.step(10));
      await page.screenshot({ path: `${capture}/selected-watering-can.png` });
    }
  }
  expect(requests).toEqual(phrases);
  expect(errors).toEqual([]);
});

test('an unavailable horse stays unchanged even when a different asset has a high score; keep preserves text', async ({ page }) => {
  await page.route('**/retrieval-api/search', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(ranking()) }));
  await start(page);
  await loadManual(page, saber.path);
  const before = await inspect(page);
  await feed(page, '馬の形をした彫刻');
  const waiting = await inspect(page);
  sameShape(waiting, before);
  expect(textOf(waiting)).toBe(textOf(before) + '馬の形をした彫刻');
  await expect(page.locator('#asset-buttons button[data-asset-id]')).toHaveCount(3);
  await page.locator('#asset-buttons').getByRole('button', { name: 'そのまま', exact: true }).click();
  sameShape(await inspect(page), before);
  expect((await inspect(page)).letters).toEqual(waiting.letters);
  await expect(page.locator('#asset-choices')).toBeHidden();
  await expect(page.locator('#asset-buttons button')).toHaveCount(0);
});

test('a new input hides old choices and replaces them only with the new search response', async ({ page }) => {
  const secondStarted = deferred(), releaseSecond = deferred();
  let calls = 0;
  await page.route('**/retrieval-api/search', async route => {
    calls++;
    if (calls === 2) { secondStarted.resolve(); await releaseSecond.promise; }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(ranking(calls === 1 ? assets : [saber, wateringCan, vase])) });
  });
  await start(page);
  await feed(page, '花瓶');
  const first = await inspect(page);
  await page.locator('#input-open').click();
  await expect(page.locator('#asset-choices')).toBeHidden();
  await page.locator('#text').fill('剣');
  await page.locator('#text').press('Enter');
  await secondStarted.promise;
  try {
    await expect(page.locator('#asset-buttons button')).toHaveCount(0);
    sameShape(await inspect(page), first);
    expect((await inspect(page)).letters).toEqual(first.letters);
  } finally { releaseSecond.resolve(); }
  await expect(page.locator('#entry')).toBeHidden();
  await expect(page.locator('#asset-buttons button[data-asset-id]').first()).toHaveAttribute('data-asset-id', saber.id);
  expect(textOf(await inspect(page))).toBe('@花瓶剣');
  expect(calls).toBe(2);
});

test('changing interpretation or manually loading a mesh clears existing asset choices', async ({ page }) => {
  await page.route('**/retrieval-api/search', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(ranking()) }));
  await start(page);
  await feed(page, 'じょうろ');
  const before = await inspect(page);
  await chooseMethod(page, 'rules');
  await expect(page.locator('#asset-choices')).toBeHidden();
  await expect(page.locator('#asset-buttons button')).toHaveCount(0);
  sameShape(await inspect(page), before);
  expect((await inspect(page)).letters).toEqual(before.letters);
  await chooseMethod(page, 'retrieve');
  await feed(page, '剣');
  const words = (await inspect(page)).letters;
  await loadManual(page, vase.path);
  await expect(page.locator('#asset-choices')).toBeHidden();
  await expect(page.locator('#asset-buttons button')).toHaveCount(0);
  expect((await inspect(page)).letters).toEqual(words);
});

test('attribute-only input edits the imported shape without searching or losing earlier letters', async ({ page }) => {
  let searches = 0;
  await page.route('**/retrieval-api/search', route => {
    searches++;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(ranking()) });
  });
  await start(page);
  await loadManual(page, wateringCan.path);
  const before = await inspect(page);
  await feed(page, '四角く、ねじれた');
  const after = await inspect(page);
  expect(searches).toBe(0);
  expect(after.loaded).toBe(before.loaded);
  expect(after.vertices).toBe(before.vertices);
  expect(after.bounds).not.toEqual(before.bounds);
  expect(after.spec.squareness).toBe(1);
  expect(after.spec.twist).not.toBe(before.spec.twist);
  expect(after.letters.slice(0, before.count)).toEqual(before.letters);
  expect(textOf(after)).toBe('@四角く、ねじれた');
  expect(after.gpuError).toBe(0);
  await expect(page.locator('#asset-choices')).toBeHidden();
  await feed(page, '赤くねじれた');
  const colored = await inspect(page);
  expect(searches).toBe(0);
  expect(colored.loaded).toBe(wateringCan.path);
  expect(colored.letters.slice(0, after.count)).toEqual(after.letters);
  expect(textOf(colored)).toBe('@四角く、ねじれた赤くねじれた');
  expect(colored.letters.slice(after.count).every((letter: { ink: string; auto: boolean }) => letter.ink === '#ef6969' && !letter.auto)).toBe(true);
});

test('a delayed candidate GLB cannot overwrite a newer manual selection', async ({ page }) => {
  const began = deferred(), release = deferred(), finished = deferred();
  const bytes = readFileSync(`public${vase.path}`);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/retrieval-api/search', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(ranking()) }));
  await page.route(`**${vase.path}`, async route => {
    began.resolve();
    await release.promise;
    await route.fulfill({ contentType: 'model/gltf-binary', body: bytes });
    finished.resolve();
  });
  await start(page);
  await feed(page, '陶器の器');
  const words = (await inspect(page)).letters;
  await page.locator(`#asset-buttons button[data-asset-id="${vase.id}"]`).click();
  await began.promise;
  try {
    await expect.poll(async () => (await inspect(page)).busy).toBe(true);
    await loadManual(page, wateringCan.path);
  } finally { release.resolve(); }
  await finished.promise;
  await expect.poll(async () => (await inspect(page)).busy).toBe(false);
  const final = await inspect(page);
  expect(final.loaded).toBe(wateringCan.path);
  expect(final.letters).toEqual(words);
  expect(final.last).toBeUndefined();
  expect(final.gpuError).toBe(0);
  await expect(page.locator('#asset-choices')).toBeHidden();
  expect(errors).toEqual([]);
});

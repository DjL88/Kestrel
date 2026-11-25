import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';

/**
 * Finish line p5-import and x-uat-offline: the whole workflow, end to end, at the owner's scale.
 *
 * Import 300 photos → pick 20 (flag) → show only the picks, select them and edit them together → export the 20 →
 * close the tab and reopen the app → every photo, every pick and every edit is still there.
 *
 * The same flow runs twice: once on a normal connection, and once with the network switched off after the app's first
 * visit (the web app has to be fetched once; after that the offline worker serves it). Both runs fail on any request
 * that would leave this machine (any host other than the local test server), because Kestrel's core use must make
 * none: no uploads, telemetry or model downloads by default.
 *
 * Synthetic photos only, made in the page. KESTREL_UAT_PHOTOS changes the count (default 300).
 */
const PHOTOS = Number(process.env.KESTREL_UAT_PHOTOS ?? 300);
const PICKS = 20;
const STEP = Math.floor(PHOTOS / PICKS);
const EXPOSURE = '0.5';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One 300-photo run is enough; the phone layout has its own UAT spec.');
});

/** Record, and refuse, every request for a host other than this machine. */
async function guardNetwork(context: BrowserContext) {
  const leaks: string[] = [];
  const local = (url: string) => {
    try {
      const { protocol, hostname } = new URL(url);
      if (!/^(https?|wss?):$/.test(protocol)) return true; // data:, blob:, chrome-extension: never leave the machine
      return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
    } catch { return true; }
  };
  context.on('request', (request) => { if (!local(request.url())) leaks.push(`${request.method()} ${request.url()}`); });
  await context.route((url) => !local(url.href), (route) => route.abort('blockedbyclient'));
  return leaks;
}

const fileName = (n: number) => `UAT_${String(n + 1).padStart(4, '0')}.jpg`;
/** The photos that are picked: every STEP-th one, spread through the shoot. */
const pickedIndices = Array.from({ length: PICKS }, (_, i) => i * STEP);

/** PHOTOS distinct JPEGs, ten minutes apart so none is grouped into a burst. */
async function makePhotos(page: Page) {
  const encoded: string[] = await page.evaluate(async (count) => {
    const canvas = document.createElement('canvas');
    canvas.width = 480; canvas.height = 320;
    const ctx = canvas.getContext('2d')!;
    const out: string[] = [];
    for (let n = 0; n < count; n += 1) {
      const grad = ctx.createLinearGradient(0, 0, 480, 320);
      grad.addColorStop(0, `hsl(${(n * 37) % 360} 45% 28%)`);
      grad.addColorStop(1, `hsl(${(n * 37 + 120) % 360} 40% 46%)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 480, 320);
      ctx.fillStyle = '#ddd';
      ctx.font = 'bold 96px sans-serif';
      ctx.fillText(String(n + 1), 40, 200);
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.85));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      out.push(btoa(binary));
    }
    return out;
  }, PHOTOS);
  return encoded.map((data, n) => ({ name: fileName(n), mimeType: 'image/jpeg', buffer: Buffer.from(data, 'base64') }));
}

/** Mean brightness (0-255) of a JPEG, decoded by the browser. */
async function meanLuma(page: Page, jpeg: Buffer) {
  return page.evaluate(async (b64) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/jpeg' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const c = canvas.getContext('2d')!;
    c.drawImage(bitmap, 0, 0);
    const d = c.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return sum / (d.length / 4);
  }, jpeg.toString('base64'));
}

async function runWorkflow(page: Page, context: BrowserContext, projectName: string) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const studio = page.locator('.inflight-v2');
  const strip = studio.getByRole('listbox', { name: 'Project photographs' });
  const options = strip.getByRole('option');
  const toReview = studio.getByTestId('decision-filter-to-review');
  const flagged = studio.getByTestId('decision-filter-flagged');

  // 1. Import 300 photos into a new project.
  await studio.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill(projectName);
  await page.getByRole('dialog').getByRole('button', { name: 'Create project', exact: true }).click();
  await studio.getByRole('button', { name: 'Import', exact: true }).first().waitFor();
  const photos = await makePhotos(page);
  const picker = page.waitForEvent('filechooser');
  await studio.getByRole('button', { name: 'Import', exact: true }).first().click();
  await (await picker).setFiles(photos);
  await expect(toReview, `all ${PHOTOS} photos import`).toHaveText(new RegExp(`To review \\(${PHOTOS}\\)`), { timeout: 60_000 + PHOTOS * 1_000 });

  // 2. Pick 20: step through the shoot from the keyboard and flag every STEP-th photo.
  await options.first().click();
  await page.locator('body').evaluate((body) => (document.activeElement as HTMLElement | null)?.blur?.() ?? body.focus());
  for (let i = 0; i < PICKS; i += 1) {
    await expect(studio.getByRole('option', { selected: true })).toContainText(fileName(pickedIndices[i]).replace(/\.jpg$/, ''));
    await page.keyboard.press('f');
    if (i < PICKS - 1) for (let s = 0; s < STEP; s += 1) await page.keyboard.press('ArrowRight');
  }
  await expect(flagged).toHaveText(new RegExp(`Flagged \\(${PICKS}\\)`));
  await expect(toReview).toHaveText(new RegExp(`To review \\(${PHOTOS - PICKS}\\)`));

  // 3. Show only the picks, select all of them and edit them together.
  await flagged.click();
  await expect(options).toHaveCount(PICKS);
  await options.first().click();
  await page.locator('body').evaluate((body) => (document.activeElement as HTMLElement | null)?.blur?.() ?? body.focus());
  await page.keyboard.press('Control+a');
  await expect(strip.getByRole('option', { selected: true }), 'Select all selects the 20 picks shown').toHaveCount(PICKS);
  if (!(await studio.getByRole('tab', { name: 'Advanced Edits' }).isVisible())) await studio.getByRole('button', { name: 'Adjust' }).first().click();
  await studio.getByRole('tab', { name: 'Advanced Edits' }).click();
  const exposure = studio.getByRole('slider', { name: 'Exposure' });
  await exposure.fill(EXPOSURE);
  await expect(exposure).toHaveValue(EXPOSURE);

  // 4. Export the 20 picks: exactly those 20 files, each with the edit in its pixels.
  await studio.getByRole('button', { name: /^Export/ }).first().click();
  const dialog = page.getByRole('dialog', { name: /export/i });
  await expect(dialog).toContainText(`${PICKS} photos`);
  const downloaded = page.waitForEvent('download', { timeout: 180_000 });
  await dialog.getByRole('button', { name: /export bundle/i }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  const files = unzipSync(await readFile((await download.path())!));
  const names = Object.keys(files).sort();
  expect(names, 'the export holds the 20 picks and nothing else').toHaveLength(PICKS);
  for (const index of pickedIndices) {
    const stem = fileName(index).replace(/\.jpg$/, '');
    expect(names.some((name) => name.includes(stem)), `${stem} is exported`).toBe(true);
  }
  for (const index of [pickedIndices[0], pickedIndices[PICKS - 1]]) {
    const stem = fileName(index).replace(/\.jpg$/, '');
    const exported = Buffer.from(files[names.find((name) => name.includes(stem))!]);
    expect(Array.from(exported.subarray(0, 2)), `${stem} is a JPEG`).toEqual([0xff, 0xd8]);
    const [before, after] = [await meanLuma(page, photos[index].buffer), await meanLuma(page, exported)];
    expect(after, `${stem}: +0.5 EV is in the exported pixels (before ${before.toFixed(1)}, after ${after.toFixed(1)})`).toBeGreaterThan(before + 8);
  }
  if (await dialog.isVisible()) await page.keyboard.press('Escape');

  // 5. Close the app and open it again: every photo, pick and edit is still there, and every original is connected.
  await studio.getByRole('button', { name: 'Back to projects' }).first().click();
  await expect(studio.getByText(projectName, { exact: true }).first()).toBeVisible();
  await page.close();
  const reopened = await context.newPage();
  reopened.on('pageerror', (error) => errors.push(error.message));
  await reopened.goto('/?v2');
  const again = reopened.locator('.inflight-v2');
  await again.getByText(projectName, { exact: true }).first().click();
  await expect(again.getByTestId('decision-filter-flagged')).toHaveText(new RegExp(`Flagged \\(${PICKS}\\)`), { timeout: 60_000 });
  await expect(again.getByTestId('decision-filter-to-review')).toHaveText(new RegExp(`To review \\(${PHOTOS - PICKS}\\)`));
  await again.getByTestId('decision-filter-all').click();
  await expect(again.getByRole('listbox', { name: 'Project photographs' }).getByRole('option'), `all ${PHOTOS} photos are back`).toHaveCount(PHOTOS);
  await again.getByTestId('decision-filter-flagged').click();
  const picks = again.getByRole('listbox', { name: 'Project photographs' }).getByRole('option');
  await expect(picks).toHaveCount(PICKS);
  if (!(await again.getByRole('tab', { name: 'Advanced Edits' }).isVisible())) await again.getByRole('button', { name: 'Adjust' }).first().click();
  for (const n of [0, PICKS - 1]) {
    await picks.nth(n).click();
    await again.getByRole('tab', { name: 'Advanced Edits' }).click();
    await expect(again.getByRole('slider', { name: 'Exposure' }), `pick ${n + 1} keeps its edit`).toHaveValue(EXPOSURE);
    await expect(again.getByText('Original not connected, preview only')).toHaveCount(0);
  }
  // A photo that was not picked was not edited.
  await again.getByTestId('decision-filter-to-review').click();
  await again.getByRole('listbox', { name: 'Project photographs' }).getByRole('option').nth(1).click();
  await again.getByRole('tab', { name: 'Advanced Edits' }).click();
  await expect(again.getByRole('slider', { name: 'Exposure' })).toHaveValue('0');
  expect(errors, 'no uncaught errors in the page').toEqual([]);
  return reopened;
}

test(`?v2 import ${PHOTOS}, pick ${PICKS}, edit, export, close and reopen: nothing lost, nothing leaves the machine`, async ({ page, context }) => {
  test.setTimeout(600_000);
  const leaks = await guardNetwork(context);
  await page.goto('/?v2');
  await runWorkflow(page, context, 'UAT online');
  expect(leaks, 'no request leaves the machine').toEqual([]);
});

test(`?v2 the same workflow with the network switched off`, async ({ page, context }) => {
  test.setTimeout(600_000);
  const leaks = await guardNetwork(context);
  // First visit online, as any web app needs: the offline worker caches the app.
  await page.goto('/?v2');
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 30_000 }).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.inflight-v2').getByRole('button', { name: 'New project' }).first()).toBeVisible();
  const reopened = await runWorkflow(page, context, 'UAT offline');
  expect(await reopened.evaluate(() => navigator.onLine), 'still offline at the end').toBe(false);
  expect(leaks, 'no request leaves the machine').toEqual([]);
});

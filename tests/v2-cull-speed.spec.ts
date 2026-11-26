import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mosaic, withPreview } from './rawFixture';

/**
 * Culling speed, measured. N synthetic RAWs (a DNG mosaic carrying a 1620 × 1080 camera-style JPEG preview, the way a
 * NEF does) are imported, then the time is taken for: the first photo and the first 20 to appear, the next photo to show after → , and rate-and-move-on
 * (a number key with "Move to the next photo after rating" on). Times are taken inside the page, from the key press to
 * the next photo's picture being decoded on screen, so the test runner's own round trips are not counted.
 *
 * Synthetic files are small (about 0.3 MB, a real NEF is 25 to 60 MB), so disk reading is not represented. The numbers
 * are for this machine only; Photo Mechanic was not run here. Set KESTREL_CULL_PHOTOS=500 for the full 500-photo run.
 * Results go to test-results/cull-speed.json.
 */
const PHOTOS = Number(process.env.KESTREL_CULL_PHOTOS ?? 120);
const STEPS = Math.min(60, PHOTOS - 2);
/** Embedded preview size. 1620 × 1080 by default; KESTREL_CULL_PREVIEW=6048x4024 is a 24 MP full-size preview like a Z 6's. */
const [PREVIEW_W, PREVIEW_H] = (process.env.KESTREL_CULL_PREVIEW ?? '1620x1080').split('x').map(Number);

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Culling with the keyboard is a desktop measurement.');
});

test(`culling ${PHOTOS} RAWs from the keyboard: each next photo shows quickly`, async ({ page }, testInfo) => {
  test.setTimeout(300_000 + PHOTOS * 1_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`${error.message}\n${error.stack ?? ''}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text().slice(0, 1500)); });
  // KESTREL_CULL_WARMUP=1 turns on the culling read-ahead preview on this device (off by default).
  if (process.env.KESTREL_CULL_WARMUP === '1') await page.addInitScript(() => localStorage.setItem('kestrel.preview.cullWarmup.v1', '1'));
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Cull speed');
  await page.getByRole('dialog').getByRole('button', { name: 'Create project', exact: true }).click();
  await root.getByRole('button', { name: 'Import', exact: true }).waitFor();

  // One preview per photo, each a little different, so no picture can be served from another's cache.
  const previews: string[] = await page.evaluate(({ count, width, height }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const out: string[] = [];
    for (let i = 0; i < Math.min(count, 12); i++) {
      for (let y = 0; y < height; y += 30) for (let x = 0; x < width; x += 30) {
        ctx.fillStyle = `rgb(${(x * 3 + i * 40) % 255},${(y * 5 + i * 17) % 255},${(x + y + i * 9) % 255})`;
        ctx.fillRect(x, y, 30, 30);
      }
      out.push(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
    }
    return out;
  }, { count: PHOTOS, width: PREVIEW_W, height: PREVIEW_H });
  const folder = mkdtempSync(join(tmpdir(), 'cull-speed-'));
  const paths: string[] = [];
  for (let i = 0; i < PHOTOS; i++) {
    const jpeg = Buffer.from(previews[i % previews.length], 'base64');
    // A unique comment segment after SOI keeps every file's bytes (and so every preview) different.
    const unique = Buffer.concat([jpeg.subarray(0, 2), Buffer.from([0xff, 0xfe, 0x00, 0x08]), Buffer.from(String(i).padStart(6, '0')), jpeg.subarray(2)]);
    const path = join(folder, `DSC_${String(i + 1).padStart(4, '0')}.dng`);
    writeFileSync(path, withPreview(mosaic, unique));
    paths.push(path);
  }

  const strip = root.getByRole('listbox', { name: 'Project photographs' });
  const importStarted = Date.now();
  const picker = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: 'Import', exact: true }).click();
  await (await picker).setFiles(paths);
  await expect(strip.getByRole('option').first()).toBeVisible({ timeout: 120_000 }).catch((reason) => { throw new Error(`${reason}\n${errors.join('\n')}`); });
  const firstPhotoMs = Date.now() - importStarted;
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('.inflight-v2 [role="listbox"][aria-label="Project photographs"] [role="option"]').length),
    { timeout: 60_000 + PHOTOS * 500 }).toBeGreaterThanOrEqual(Math.min(PHOTOS, 20));
  const first20Ms = Date.now() - importStarted;

  // Start on the first photo, with the keyboard focus on the page itself (not a field or a slider).
  await strip.getByRole('option').first().click();
  await page.locator('body').evaluate((body) => (document.activeElement as HTMLElement | null)?.blur?.() ?? body.focus());

  /**
   * Press a real key and time, inside the page, from the key-down to the canvas showing a different, fully decoded
   * picture. The clock starts on the page's own keydown, so the test runner's round trips are not counted.
   */
  const timeKey = async (key: string) => {
    await page.evaluate(() => {
      const picture = () => document.querySelector<HTMLImageElement>('.inflight-v2 [data-testid="canvas-frame"] img');
      const before = picture()?.currentSrc ?? '';
      (window as unknown as { cullTiming: Promise<number> }).cullTiming = new Promise<number>((resolve) => {
        window.addEventListener('keydown', async () => {
          const started = performance.now();
          for (;;) {
            await new Promise(requestAnimationFrame);
            const img = picture();
            if (img && img.currentSrc && img.currentSrc !== before && img.complete && img.naturalWidth > 0) {
              await img.decode().catch(() => undefined);
              resolve(performance.now() - started);
              return;
            }
            if (performance.now() - started > 10_000) { resolve(Number.POSITIVE_INFINITY); return; }
          }
        }, { once: true, capture: true });
      });
    });
    await page.keyboard.press(key);
    return page.evaluate(() => (window as unknown as { cullTiming: Promise<number> }).cullTiming);
  };

  const next: number[] = [];
  for (let i = 0; i < STEPS / 2; i++) next.push(await timeKey('ArrowRight'));

  // Settings → Keyboard: Move to the next photo after rating. Then rate 3 and time until the next photo shows.
  await page.keyboard.press('Control+Comma');
  const settings = page.getByRole('dialog').filter({ hasText: 'Settings' }).first();
  await settings.getByRole('tab', { name: /Keyboard/ }).click();
  await settings.getByRole('switch', { name: /Move to the next photo after rating/ }).click();
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  await page.locator('body').evaluate((body) => (document.activeElement as HTMLElement | null)?.blur?.() ?? body.focus());
  const rated: number[] = [];
  for (let i = 0; i < STEPS / 2; i++) rated.push(await timeKey('3'));

  const stats = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const at = (q: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]);
    return { count: sorted.length, medianMs: at(0.5), p95Ms: at(0.95), worstMs: Math.round(sorted[sorted.length - 1]) };
  };
  const result = {
    photos: PHOTOS, preview: `${PREVIEW_W}x${PREVIEW_H}`, readAhead: process.env.KESTREL_CULL_WARMUP === '1', firstPhotoMs, first20Ms,
    nextPhoto: stats(next), rateAndMoveOn: stats(rated),
    note: 'Synthetic DNGs with an embedded JPEG preview of the size above, headless Chromium, built app. Measured while the import still works in the background. Not a Photo Mechanic comparison.',
  };
  writeFileSync(testInfo.outputPath('cull-speed.json'), JSON.stringify(result, null, 2));
  writeFileSync('test-results/cull-speed.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));

  // Ceilings, generous for slow shared CI machines: a regression guard, not the published number.
  expect(result.nextPhoto.medianMs).toBeLessThan(400);
  expect(result.rateAndMoveOn.medianMs).toBeLessThan(400);
  expect(Number.isFinite(result.nextPhoto.worstMs) && Number.isFinite(result.rateAndMoveOn.worstMs)).toBe(true);
});

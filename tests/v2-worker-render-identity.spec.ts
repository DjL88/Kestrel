import { expect, test, type Page } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Uses the desktop Adjust panel.');
});

async function shown(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const img = document.querySelector<HTMLImageElement>('[data-testid="canvas-frame"] img[data-preview-quality="full"]')!;
    await img.decode().catch(() => undefined);
    const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const digest = await crypto.subtle.digest('SHA-256', ctx.getImageData(0, 0, canvas.width, canvas.height).data);
    return `${canvas.width}x${canvas.height}:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')}`;
  });
}

async function settled(page: Page) {
  const frame = page.getByTestId('canvas-frame');
  await expect(frame.locator('img[data-preview-quality="full"]').first()).toBeVisible({ timeout: 60_000 });
  await expect(frame.getByRole('status', { name: 'Refreshing image' })).toHaveCount(0, { timeout: 60_000 });
  await expect(frame.getByTestId('live-picture')).toBeHidden({ timeout: 60_000 });
}

const shownSrc = (page: Page) => page.locator('[data-testid="canvas-frame"] img[data-preview-quality="full"]').first().getAttribute('src');

/**
 * One slider step, then the picture for it: each full-quality picture is a new file, so the step is waited for until the
 * one shown is not the one before it. settled() alone can pass in the moment before the new drawing starts, and then the
 * previous step's picture was read (on CI, 27 Nov: contrast 19's picture compared with contrast 18's).
 */
async function step(page: Page, slider: ReturnType<Page['locator']>, value: string) {
  const before = await shownSrc(page);
  await slider.fill(value);
  await expect.poll(() => shownSrc(page), { timeout: 60_000 }).not.toBe(before);
  await settled(page);
}

/**
 * The full-quality picture is drawn in a background worker (its tone on the graphics card there, as on the page) so a
 * slider let go never holds the page, but only for a kind of edit the worker has already drawn byte for byte as the
 * page did on this machine (graphics differ between machines). Quality must not change: whichever drew it, the picture is the page's, pixel for
 * pixel.
 */
test('?v2 the full-quality picture drawn in the worker is pixel-identical to the one drawn on the page', async ({ page }) => {
  test.setTimeout(240_000);
  await page.route(/\.(onnx|ort)(\?|$)/, (route) => route.abort());
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Worker identity');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const photo = await page.evaluate(async () => {
    const width = 3000, height = 2000;
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#2d4a6b'); gradient.addColorStop(0.5, '#c7b28d'); gradient.addColorStop(1, '#5a3a2a');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height);
    let seed = 3;
    for (let i = 0; i < data.data.length; i += 4) for (let c = 0; c < 3; c += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data.data[i + c] = Math.max(0, Math.min(255, data.data[i + c] + ((seed >> 8) % 15) - 7));
    }
    ctx.putImageData(data, 0, 0);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'identity.png', mimeType: 'image/png', buffer: Buffer.from(photo, 'base64') }]);
  await settled(page);

  const advanced = root.getByRole('tab', { name: 'Advanced Edits' });
  if (!await advanced.isVisible()) await root.getByRole('button', { name: 'Adjust' }).first().click();
  await advanced.click();
  // Tone on the graphics card (exposure, contrast, saturation) and an early stage (dehaze).
  await step(page, root.getByRole('slider', { name: 'Exposure' }), '0.4');
  await step(page, root.getByRole('slider', { name: 'Contrast' }), '18');
  await step(page, root.getByRole('slider', { name: 'Saturation', exact: true }).first(), '-12');
  await step(page, root.locator('#slider-dehaze'), '20');
  // That edit was drawn on the page and, once, in the worker too; only if every byte matched is the worker trusted with
  // this kind of edit. A step away and back (the same kind of edit) is then drawn by whichever is trusted.
  await expect.poll(() => page.evaluate(() => performance.getEntriesByName('inflight:preview:worker-verify').length), { timeout: 30_000 }).toBeGreaterThan(0);
  const contrastStep = root.getByRole('slider', { name: 'Contrast' });
  const before = await page.evaluate(() => performance.getEntriesByName('inflight:preview:edit-worker').length);
  await step(page, contrastStep, '19');
  await step(page, contrastStep, '18');
  const { usedWorker, workerMatches } = await page.evaluate((count) => {
    const verifies = performance.getEntriesByName('inflight:preview:worker-verify') as PerformanceMeasure[];
    return {
      usedWorker: performance.getEntriesByName('inflight:preview:edit-worker').length - count,
      workerMatches: verifies.at(-1)?.detail?.same as boolean | undefined,
    };
  }, before);
  test.info().annotations.push({ type: 'worker render', description: workerMatches ? 'matched the page here: used' : 'differed from the page here: not used' });
  if (workerMatches) expect(usedWorker, 'the full-quality picture was drawn in the worker').toBeGreaterThan(0);
  else expect(usedWorker, 'where the worker drew differently, the page draws every full-quality picture').toBe(0);
  const fromWorker = await shown(page);

  // The same edit drawn on the page: switch to the page renderer and step one slider away and back.
  await page.evaluate(() => localStorage.setItem('inflight.debug.page-render', '1'));
  const contrast = root.getByRole('slider', { name: 'Contrast' });
  await step(page, contrast, '19');
  await step(page, contrast, '18');
  const fromPage = await shown(page);
  expect(fromWorker).toBe(fromPage);
});

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

/**
 * The full-quality picture is drawn in a background worker (its tone on the graphics card there, as on the page) so a
 * slider let go never holds the page, but only where a check at start shows the worker draws exactly as the page does
 * (graphics differ between machines). Quality must not change: whichever drew it, the picture is the page's, pixel for
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
  await root.getByRole('slider', { name: 'Exposure' }).fill('0.4');
  await settled(page);
  await root.getByRole('slider', { name: 'Contrast' }).fill('18');
  await settled(page);
  await root.getByRole('slider', { name: 'Saturation', exact: true }).first().fill('-12');
  await settled(page);
  await root.locator('#slider-dehaze').fill('20');
  await settled(page);
  // Whether the worker draws exactly as the page does on this machine (its graphics may differ): only then is it used.
  const { usedWorker, workerMatches } = await page.evaluate(() => ({
    usedWorker: performance.getEntriesByName('inflight:preview:edit-worker').length,
    workerMatches: (performance.getEntriesByName('inflight:preview:worker-check')[0] as PerformanceMeasure | undefined)?.detail?.same as boolean | undefined,
  }));
  test.info().annotations.push({ type: 'worker render', description: workerMatches ? 'matches the page here: used' : 'differs from the page here: not used' });
  if (workerMatches) expect(usedWorker, 'the full-quality picture was drawn in the worker').toBeGreaterThan(0);
  else expect(usedWorker, 'where the worker draws differently, the page draws every full-quality picture').toBe(0);
  const fromWorker = await shown(page);

  // The same edit drawn on the page: switch to the page renderer and step one slider away and back.
  await page.evaluate(() => localStorage.setItem('inflight.debug.page-render', '1'));
  const contrast = root.getByRole('slider', { name: 'Contrast' });
  await contrast.fill('19');
  await settled(page);
  await contrast.fill('18');
  await settled(page);
  const fromPage = await shown(page);
  expect(fromWorker).toBe(fromPage);
});

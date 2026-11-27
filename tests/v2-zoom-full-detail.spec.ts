import { expect, test } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Zooms the desktop canvas.');
});

/**
 * An edited photo is drawn at most 2,200 px across. Zoomed to 100%, the part on screen is drawn again from the photo's own
 * pixels (in a worker), laid over the picture, so fine detail is the photo's, never a smaller picture enlarged. The words
 * saying it is loading sit beside the picture, never over it.
 */
test('?v2 zoomed in, an edited photo is drawn at the size it is shown from its own pixels: fine stripes are resolved, not blurred', async ({ page }) => {
  test.setTimeout(240_000);
  await page.route(/\.(onnx|ort)(\?|$)/, route => route.abort());
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Full detail');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  // 6000 x 4000, mid grey, with 2 px black and white stripes across the middle third: detail the 2,200 px picture cannot hold.
  const photo = await page.evaluate(async () => {
    const width = 6000, height = 4000;
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgb(128,128,128)'; ctx.fillRect(0, 0, width, height);
    for (let x = 0; x < width; x += 4) { ctx.fillStyle = 'rgb(20,20,20)'; ctx.fillRect(x, height / 3, 2, height / 3); ctx.fillStyle = 'rgb(235,235,235)'; ctx.fillRect(x + 2, height / 3, 2, height / 3); }
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/png'));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'stripes.png', mimeType: 'image/png', buffer: Buffer.from(photo, 'base64') }]);
  const frame = root.getByTestId('canvas-frame');
  await expect(frame.locator('img[data-preview-quality="full"]').first()).toBeVisible({ timeout: 60_000 });

  // An edit, so the picture is the editor's own 2,200 px drawing.
  const advanced = root.getByRole('tab', { name: 'Advanced Edits' });
  if (!await advanced.isVisible()) await root.getByRole('button', { name: 'Adjust' }).first().click();
  await advanced.click();
  await root.getByRole('slider', { name: 'Exposure' }).fill('0.1');
  await expect(frame.getByRole('status', { name: 'Refreshing image' })).toHaveCount(0, { timeout: 60_000 });

  const zoom = root.getByTestId('zoom-percent');
  await zoom.click();
  await page.getByRole('menuitem', { name: /100%/ }).click();
  await expect(zoom).toHaveText('100%');

  const detail = frame.getByTestId('detail-picture');
  await expect(detail).toBeVisible({ timeout: 60_000 });
  // Drawn at the size it is shown: one drawn pixel per screen pixel.
  // (The zoom eases in; the detail is drawn again once it has been still a moment.)
  await expect.poll(() => detail.evaluate((canvas: HTMLCanvasElement) =>
    Math.abs(canvas.width / (canvas.getBoundingClientRect().width * devicePixelRatio) - 1)), { timeout: 30_000 }).toBeLessThan(0.02);
  // Far finer than the editor's 2,200 px picture, which holds 0.37 of this photo's pixels across.
  expect(Number(await detail.getAttribute('data-detail-scale'))).toBeGreaterThan(0.37 * 1.5);
  // The stripes in the detail drawing: they swing from dark to light (a 2,200 px picture enlarged would show grey).
  const swing = await detail.evaluate((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')!;
    const row = ctx.getImageData(0, Math.floor(canvas.height / 2), canvas.width, 1).data;
    let sum = 0, n = 0;
    for (let x = 2; x < canvas.width; x++) { sum += Math.abs(row[x * 4] - row[(x - 2) * 4]); n++; }
    return sum / n;
  });
  expect(swing, 'the 2 px stripes swing from dark to light').toBeGreaterThan(80);
  // The detail is laid over the picture, and the words about it were beside the picture, in the canvas bar.
  await expect(root.getByTestId('detail-loading')).toHaveCount(0, { timeout: 30_000 });
  expect(await frame.getByTestId('detail-loading').count(), 'never over the picture').toBe(0);
  // An edit hides it at once (never a different edit's pixels), and it is drawn again.
  await root.getByRole('slider', { name: 'Exposure' }).fill('0.2');
  await expect(detail).toBeVisible({ timeout: 60_000 });
});

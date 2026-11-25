import { expect, test } from '@playwright/test';
import { mosaic, withPreview } from './rawFixture';

// Owner report (25 Nov): a RAW shows in Single view, but the All formats board shows a broken image. The background
// develop revokes the embedded preview's blob URL; the board drew that dead URL straight from `photo.previewUrl`.
test('All formats keeps showing a RAW after the background develop replaces its embedded preview', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('V2 RAW all formats');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const preview = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 960;
    const ctx = canvas.getContext('2d')!;
    for (let y = 0; y < 960; y += 16) for (let x = 0; x < 640; x += 16) {
      ctx.fillStyle = `rgb(${(x * 7 + y) % 255},${(x + y * 3) % 255},${(x * 5 + y * 11) % 255})`;
      ctx.fillRect(x, y, 16, 16);
    }
    return canvas.toDataURL('image/jpeg', 0.92).split(',')[1];
  }), 'base64');
  const picker = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: 'Import', exact: true }).click();
  await (await picker).setFiles([{ name: 'v2-board.dng', mimeType: 'application/octet-stream', buffer: withPreview(mosaic, preview) }]);

  // Wait until Single view shows the developed sensor pixels (64 × 96), so the embedded preview's URL has been revoked.
  const single = root.getByTestId('canvas-frame').locator('img').first();
  await expect.poll(() => single.evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight]), { timeout: 30_000 }).toEqual([64, 96]);

  await root.getByRole('button', { name: /All formats/ }).click();
  const tile = root.getByTestId('format-pair-orig-3x2').locator('img').first();
  await expect(tile).toBeVisible();
  // A revoked blob URL never loads: complete with zero natural width is the browser's broken-image state.
  await expect.poll(() => tile.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), { timeout: 15_000 }).toBe(true);
});

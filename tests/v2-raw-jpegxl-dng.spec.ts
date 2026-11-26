import { expect, test } from '@playwright/test';
import { syntheticDng } from '../src/core/syntheticDngFixture';

// A synthetic Lightroom-style linear DNG whose main image is JPEG XL (which InFlight can't decode yet) and whose only
// baseline JPEG is a 256 × 171 thumbnail. No real photo: the thumbnail is drawn on a canvas.
test('V2 shows a JPEG XL DNG by its small camera preview and says plainly why it cannot be developed', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('JPEG XL DNG');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const thumb = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 171;
    const ctx = canvas.getContext('2d')!;
    for (let y = 0; y < 171; y += 8) for (let x = 0; x < 256; x += 8) {
      ctx.fillStyle = `rgb(${(x * 3) % 255},${(y * 5) % 255},${(x + y) % 255})`;
      ctx.fillRect(x, y, 8, 8);
    }
    return canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
  }), 'base64');
  const dng = Buffer.from(await syntheticDng({ main: 52546, others: [[1, 52546]], thumb: new Uint8Array(thumb) }).arrayBuffer());
  const picker = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: 'Import', exact: true }).click();
  await (await picker).setFiles([{ name: 'enhanced.dng', mimeType: 'application/octet-stream', buffer: dng }]);

  // The tile says what is true (the original is here; its compression can't be read yet), never "Original unavailable".
  const strip = root.getByRole('listbox', { name: 'Project photographs' });
  await expect(strip.getByText('Can’t read yet')).toBeVisible({ timeout: 30_000 });
  await expect(strip.getByText('JPEG XL compression', { exact: false })).toHaveCount(1); // the full sentence, for screen readers
  await expect(root.getByText('Original unavailable')).toHaveCount(0);
  // The camera's own small preview is shown, and labelled as the camera preview.
  const photo = root.getByTestId('canvas-frame').locator('img').first();
  await expect.poll(() => photo.evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight]), { timeout: 30_000 }).toEqual([256, 171]);
  await expect(root.locator('.v2-canvas-bar [data-testid="picture-source"]')).toHaveAttribute('data-picture-source', 'camera-preview');
  // No develop is offered that could only fail.
  await expect(root.locator('.v2-canvas-bar').getByRole('button', { name: /Develop full size/ })).toHaveCount(0);
});

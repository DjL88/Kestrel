import { expect, test, type Page } from '@playwright/test';
import { openExportAdvanced } from './helpers';

/**
 * Owner checklist: see a 2× or 4× output enlargement on the canvas before exporting. The preview is made by the export's
 * own job renderer, so it must match the exported file: same size, same pixels. Both are lossless PNGs here, so the
 * comparison is exact apart from rounding.
 */

async function pixels(page: Page, url: string) {
  return page.evaluate(async (src) => {
    const bitmap = await createImageBitmap(await (await fetch(src)).blob());
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    // A short digest of every pixel, plus a few samples, so the comparison stays cheap to pass back.
    let hash = 0;
    for (let i = 0; i < data.length; i += 1) hash = (hash * 31 + data[i]) | 0;
    const samples = [0.1, 0.33, 0.5, 0.71, 0.9].flatMap((fy) => [0.1, 0.5, 0.9].map((fx) => {
      const x = Math.floor(fx * bitmap.width); const y = Math.floor(fy * bitmap.height); const at = (y * bitmap.width + x) * 4;
      return [data[at], data[at + 1], data[at + 2]];
    }));
    return { width: bitmap.width, height: bitmap.height, hash, samples };
  }, url);
}

test('the enlargement preview is the exported picture: same size and pixels as the PNG export', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'Enhance and Export are reached from the desktop rail and top bar here.');
  test.setTimeout(180_000);
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Enlargement preview');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();

  // A small picture with edges and a gradient, so a different resampling or placement would change the pixels.
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 300; c.height = 200;
    const ctx = c.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 300, 200); gradient.addColorStop(0, '#203040'); gradient.addColorStop(1, '#e0a060');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 300, 200);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(120, 70, 60, 60);
    ctx.fillStyle = '#000000'; for (let x = 10; x < 290; x += 14) ctx.fillRect(x, 160, 4, 30);
    return c.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'enlarge.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  await expect(root.getByTestId('canvas-frame').locator('img').first()).toBeVisible({ timeout: 30_000 });

  await root.getByRole('button', { name: 'Enhance', exact: true }).first().click();
  await expect(root.getByTestId('v2-preview-enlargement')).toHaveCount(0); // nothing to preview at 1×
  await root.getByRole('button', { name: '2×', exact: true }).click();
  await root.getByTestId('v2-preview-enlargement').click();

  const dialog = page.getByTestId('v2-enlargement-preview');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Enlargement preview' })).toBeVisible();
  const image = dialog.getByTestId('v2-enlargement-image');
  await expect(image).toBeVisible({ timeout: 90_000 });
  await expect(dialog).toContainText('600 × 400');
  const preview = await pixels(page, (await image.getAttribute('src'))!);
  expect([preview.width, preview.height]).toEqual([600, 400]);
  await dialog.getByRole('button', { name: 'Close the enlargement preview' }).click();
  await expect(dialog).toHaveCount(0);

  // Export the same photo and format, as a PNG.
  await root.getByRole('button', { name: /^Export/ }).first().click();
  const exportDialog = page.getByRole('dialog', { name: /export/i });
  await exportDialog.getByRole('button', { name: /Download individual files/i }).click();
  await openExportAdvanced(exportDialog);
  await exportDialog.getByRole('combobox', { name: /File format/i }).selectOption('png');
  const downloading = page.waitForEvent('download', { timeout: 90_000 });
  await exportDialog.getByRole('button', { name: /^Save files$/i }).click();
  const path = await (await downloading).path();
  const { readFileSync } = await import('node:fs');
  const exported = await pixels(page, `data:image/png;base64,${readFileSync(path).toString('base64')}`);

  expect([exported.width, exported.height]).toEqual([preview.width, preview.height]);
  for (let i = 0; i < preview.samples.length; i += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      expect(Math.abs(preview.samples[i][channel] - exported.samples[i][channel]), `sample ${i}, channel ${channel}`).toBeLessThanOrEqual(1);
    }
  }
  expect(exported.hash, 'every pixel matches').toBe(preview.hash);
});

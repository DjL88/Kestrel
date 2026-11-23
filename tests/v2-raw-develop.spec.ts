import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { mosaic, withPreview } from './rawFixture';
import { proveTiff16 } from '../src/core/tiff16Proof';
test('V2 background engine replaces a synthetic embedded RAW preview with developed sensor pixels', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('V2 sensor develop');
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
  await (await picker).setFiles([{ name: 'v2-sensor.dng', mimeType: 'application/octet-stream', buffer: withPreview(mosaic, preview) }]);
  const photo = root.getByTestId('canvas-frame').locator('img').first();
  await expect(photo).toBeVisible();
  const dimensions = () => photo.evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight]);
  // The embedded JPEG is 640 × 960. Only the developed, orientation-corrected mosaic produces 64 × 96.
  await expect.poll(dimensions, { timeout: 30_000 }).toEqual([64, 96]);
  await root.getByRole('button', { name: 'Back to projects' }).click();
  await page.reload();
  await root.getByRole('button', { name: /Open studio/ }).first().click();
  await expect.poll(dimensions, { timeout: 30_000 }).toEqual([64, 96]);
});

test('V2 writes a structurally verified 16-bit TIFF from a synthetic RAW original', async ({ page }) => {
  await page.goto('/?v2');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('V2 RAW TIFF');
  await studio.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  await studio.getByRole('button', { name: 'Import', exact: true }).waitFor();
  await studio.evaluate((target, base64) => {
    const dataTransfer = new DataTransfer();
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    dataTransfer.items.add(new File([bytes], 'synthetic-z8.dng', { type: 'application/octet-stream' }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
  }, Buffer.from(mosaic).toString('base64'));
  await expect(studio.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  await studio.getByRole('button', { name: 'Export', exact: true }).first().click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    studio.getByRole('button', { name: 'Save 16-bit RAW TIFF' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('synthetic-z8_16bit.tif');
  const bytes = Uint8Array.from(await readFile((await download.path())!));
  const proof = proveTiff16(bytes.buffer);
  expect([proof.width, proof.height]).toEqual([64, 96]);
  expect(proof.iccBytes).toBeGreaterThan(128);
});

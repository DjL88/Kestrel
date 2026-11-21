import { readFileSync } from 'node:fs';
import { mosaic, withPreview } from './rawFixture';
import { expect, test } from '@playwright/test';

/**
 * The web app develops RAW sensor data with Kite44's own pipeline compiled to WebAssembly, like the desktop app does
 * natively. The file is synthetic: a 96 × 64 Bayer mosaic written by ticoraw's DNG writer (tests/fixtures), plus an
 * embedded JPEG preview added here, as cameras store one. No camera data.
 */

test('a RAW opened in the web app is developed from its sensor data, and says so', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  // A portrait preview with some texture, as the camera would store for a frame held upright (orientation 6).
  const preview = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 960;
    const c = canvas.getContext('2d')!;
    for (let y = 0; y < 960; y += 16) for (let x = 0; x < 640; x += 16) {
      c.fillStyle = `rgb(${(x * 7 + y) % 255},${(x + y * 3) % 255},${(x * 5 + y * 11) % 255})`; c.fillRect(x, y, 16, 16);
    }
    return canvas.toDataURL('image/jpeg', 0.92).split(',')[1];
  }), 'base64');
  expect(preview.length).toBeGreaterThan(4096);
  await page.getByTestId('quick-edit-input').setInputFiles({ name: 'synthetic.dng', mimeType: 'application/octet-stream', buffer: withPreview(mosaic, preview) });
  await page.getByRole('tab', { name: 'Edit' }).click({ timeout: 20000 });
  const all = page.getByRole('button', { name: 'All controls' });
  if (await all.isVisible()) await all.click();
  // Since #504 the camera preview stays until the person asks for the sensor data to be developed.
  await page.getByRole('button', { name: 'Develop from RAW' }).click({ timeout: 20000 });
  await expect(page.getByText('Made from your RAW file.', { exact: false })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText('keeps using the preview stored in the file', { exact: false })).toHaveCount(0);
  // The DNG copy is a desktop extra; the 16-bit TIFF is made in the browser too.
  await expect(page.getByRole('button', { name: 'Save a DNG copy' })).toHaveCount(0);

  // A 16-bit TIFF straight from the sensor data, through the same WebAssembly decoder and the screen's edit maths.
  await page.getByRole('slider', { name: /^Exposure/ }).first().fill('0.5');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export photo' });
  await dialog.getByRole('tab', { name: 'Advanced', exact: true }).click();
  const download = page.waitForEvent('download', { timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Export 16-bit RAW TIFF (prototype)' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('synthetic_16bit.tif');
  const tiff = readFileSync(await file.path());
  expect(tiff.readUInt16LE(0)).toBe(0x4949);
  const ifd = tiff.readUInt32LE(4);
  const tags = new Map<number, number>();
  for (let i = 0; i < tiff.readUInt16LE(ifd); i += 1) {
    const at = ifd + 2 + i * 12;
    const short = tiff.readUInt16LE(at + 2) === 3 && tiff.readUInt32LE(at + 4) === 1;
    tags.set(tiff.readUInt16LE(at), short ? tiff.readUInt16LE(at + 8) : tiff.readUInt32LE(at + 8));
  }
  // Full size and turned the way the camera was held, like the picture on screen: 64 x 96.
  expect([tags.get(256), tags.get(257)]).toEqual([64, 96]);
  expect(tiff.readUInt16LE(tags.get(258)!)).toBe(16);
  // Real 16-bit values, not 8-bit ones scaled up (which would all be multiples of 257).
  const start = tags.get(273)!;
  let notScaled = 0;
  for (let i = 0; i < 64 * 96 * 3; i += 1) if (tiff.readUInt16LE(start + i * 2) % 257 !== 0) notScaled += 1;
  expect(notScaled).toBeGreaterThan(64 * 96);
  expect(tags.has(34675), 'the TIFF includes an ICC profile tag').toBe(true);
  await expect(dialog).toBeHidden();
});

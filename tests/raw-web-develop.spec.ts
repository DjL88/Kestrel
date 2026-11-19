import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * The web app develops RAW sensor data with Kestrel's own pipeline compiled to WebAssembly, like the desktop app does
 * natively. The file is synthetic: a 96 × 64 Bayer mosaic written by ticoraw's DNG writer (tests/fixtures), plus an
 * embedded JPEG preview added here, as cameras store one. No camera data.
 */
const mosaic = readFileSync(new URL('./fixtures/synthetic-z8.dng', import.meta.url));

/** Add a second TIFF directory pointing at a JPEG preview, the way RAW files carry one (tags 0x0201 and 0x0202). */
function withPreview(dng: Buffer, jpeg: Buffer): Buffer {
  if (dng.readUInt16LE(0) !== 0x4949) throw new Error('expected a little-endian DNG');
  const first = dng.readUInt32LE(4);
  const nextPointerAt = first + 2 + dng.readUInt16LE(first) * 12;
  const padded = (length: number) => length + (length % 2);
  const previewAt = padded(dng.length);
  const directoryAt = padded(previewAt + jpeg.length);
  const out = Buffer.alloc(directoryAt + 2 + 2 * 12 + 4);
  dng.copy(out, 0);
  jpeg.copy(out, previewAt);
  out.writeUInt32LE(directoryAt, nextPointerAt);
  out.writeUInt16LE(2, directoryAt);
  const entry = (index: number, tag: number, value: number) => {
    const at = directoryAt + 2 + index * 12;
    out.writeUInt16LE(tag, at); out.writeUInt16LE(4, at + 2); out.writeUInt32LE(1, at + 4); out.writeUInt32LE(value, at + 8);
  };
  entry(0, 0x0201, previewAt);
  entry(1, 0x0202, jpeg.length);
  out.writeUInt32LE(0, directoryAt + 2 + 2 * 12);
  return out;
}

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
  await expect(page.getByText('Developed from the RAW file', { exact: false })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText('keeps using the preview stored in the file', { exact: false })).toHaveCount(0);
  // Desktop-only extras stay off in the browser.
  await expect(page.getByRole('button', { name: /16-bit TIFF/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save a DNG copy' })).toHaveCount(0);
});

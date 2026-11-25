import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { mosaic } from './rawFixture';

/** The synthetic DNG (96 × 64 sensor) with its Orientation tag set to `orientation`. */
function withOrientation(orientation: number): Buffer {
  const dng = Buffer.from(mosaic);
  const directory = dng.readUInt32LE(4);
  for (let i = 0; i < dng.readUInt16LE(directory); i += 1) {
    const entry = directory + 2 + i * 12;
    if (dng.readUInt16LE(entry) === 0x0112) { dng.writeUInt16LE(orientation, entry + 8); return dng; }
  }
  throw new Error('The fixture has no Orientation tag.');
}

/** Width and height from a JPEG's frame header. */
function jpegSize(bytes: Uint8Array): [number, number] {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    const marker = bytes[offset + 1];
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return [(bytes[offset + 7] << 8) | bytes[offset + 8], (bytes[offset + 5] << 8) | bytes[offset + 6]];
    offset += 2 + length;
  }
  throw new Error('No JPEG frame header.');
}

// Owner rule (lead, 25 Nov): a RAW export's pixel size comes from the RAW's own sensor size and orientation, never from a
// smaller picture shown on screen. The export no longer makes a full-size 8-bit develop first, so prove the size is the
// sensor's, portrait and landscape. (Whether a full develop happened is not visible here: with the photo open, Co-pilot's
// own check develops it at full size anyway.)
for (const [orientation, size] of [[6, [64, 96]], [8, [64, 96]], [1, [96, 64]]] as const) {
  test(`a RAW exported as JPEG is the sensor's full size, turned the camera's way (Orientation ${orientation})`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'One project is enough: the size rule is shared.');
    await page.goto('/?v2');
    const studio = page.locator('.inflight-v2');
    await studio.getByRole('button', { name: 'New project' }).first().click();
    await page.getByLabel('Project name', { exact: true }).fill(`RAW size ${orientation}`);
    await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
    await studio.getByRole('button', { name: 'Import', exact: true }).first().waitFor();
    await studio.evaluate((target, base64) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File([Uint8Array.from(atob(base64), char => char.charCodeAt(0))], 'sensor.dng', { type: 'application/octet-stream' }));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    }, withOrientation(orientation).toString('base64'));
    const tiles = studio.getByRole('listbox', { name: 'Project photographs' });
    await expect(tiles.getByRole('option')).toHaveCount(1);
    // The background develop has stored its screen-size picture.
    await expect(tiles.getByTestId('picture-source')).toHaveAttribute('data-picture-source', 'raw-screen', { timeout: 30_000 });

    const dialog = page.getByRole('dialog', { name: /export/i });
    await studio.getByRole('button', { name: /^Export/ }).first().click();
    const downloaded = page.waitForEvent('download');
    await dialog.getByRole('button', { name: /export bundle/i }).click();
    const files = Object.entries(unzipSync(await readFile((await (await downloaded).path())!)));
    // The default bundle holds one developed file: the Original format at the photo's full size.
    expect(files).toHaveLength(1);
    const [[name, bytes]] = files;
    expect(name).toMatch(/\.jpe?g$/i);
    expect(jpegSize(bytes), name).toEqual(size);
  });
}

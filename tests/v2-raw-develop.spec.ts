import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { mosaic, withPreview } from './rawFixture';
import { proveTiff16 } from '../src/core/tiff16Proof';
import { provePng } from '../src/core/png16';
test('V2 background engine replaces a synthetic embedded RAW preview with developed sensor pixels', async ({ page }, testInfo) => {
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
  // The canvas and the filmstrip say, in words, that this is InFlight's develop from the sensor data.
  const canvasLabel = root.locator('.v2-canvas-bar [data-testid="picture-source"]');
  await expect(canvasLabel).toHaveAttribute('data-picture-source', /^raw-/);
  await expect(canvasLabel).toContainText('Developed from RAW');
  const tileLabel = root.getByRole('listbox', { name: 'Project photographs' }).getByTestId('picture-source');
  const tileImage = root.getByRole('listbox', { name: 'Project photographs' }).locator('img').first();
  // The tile catches up a moment after the canvas; its label follows the picture it actually shows.
  await expect(tileLabel).toHaveAttribute('data-picture-source', 'raw-screen', { timeout: 30_000 });
  await expect.poll(() => tileImage.evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight])).toEqual([64, 96]);
  await expect(tileLabel).toContainText('RAW');
  await root.getByRole('button', { name: 'Back to projects' }).click();
  await page.reload();
  // The project's name opens it at every width; the separate Open studio link is wide-screen only since #1376.
  await root.getByRole('button', { name: 'V2 sensor develop', exact: true }).first().click();
  await expect.poll(dimensions, { timeout: 30_000 }).toEqual([64, 96]);
  // A full develop is kept for one session; after a reload the stored screen-size develop is shown, and the label says so.
  await expect(canvasLabel).toHaveAttribute('data-picture-source', 'raw-screen');
  // One button develops the sensor data at full size; the label then says so and the button goes away.
  const bar = root.locator('.v2-canvas-bar');
  await bar.getByRole('button', { name: 'Develop full size' }).click();
  await expect(canvasLabel).toHaveAttribute('data-picture-source', 'raw-full', { timeout: 30_000 });
  await expect(bar.getByRole('button', { name: /Develop full size|Developing full size/ })).toHaveCount(0);
  // The editor's picture is then drawn from the 16-bit develop (edit maths at 16 bits, one rounding to the screen).
  await expect(root.getByTestId('canvas-frame').locator('img[data-precision="rgb16"]').first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(dimensions).toEqual([64, 96]);
  // The histogram of InFlight's own develop is measured again from the 16-bit sensor develop, and says so in words.
  // (The panel is shared; on a phone it sits behind More, which other specs cover.)
  if (testInfo.project.name !== 'desktop') return;
  await root.getByRole('button', { name: 'Info', exact: true }).first().click();
  const precision = root.getByTestId('histogram-precision');
  await expect(precision).toHaveAttribute('data-precision', 'rgb16', { timeout: 30_000 });
  await expect(precision).toHaveText('Measured from the 16-bit RAW develop.');
  // An edit is drawn from the 16-bit develop too: brighter, and still from the sensor data.
  const sensorPicture = root.getByTestId('canvas-frame').locator('img[data-precision="rgb16"]').first();
  const mean = () => sensorPicture.evaluate((img: HTMLImageElement) => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(img, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let total = 0; for (let i = 0; i < data.length; i += 4) total += data[i] + data[i + 1] + data[i + 2];
    return total / (data.length / 4 * 3);
  });
  const before = await mean();
  const advanced = root.getByRole('tab', { name: 'Advanced Edits' });
  if (!(await advanced.isVisible())) await root.getByRole('button', { name: 'Adjust', exact: true }).first().click();
  await advanced.click();
  await root.getByLabel('Exposure', { exact: true }).fill('1');
  await expect.poll(mean, { timeout: 30_000 }).toBeGreaterThan(before + 3);
  await expect(sensorPicture).toBeVisible();
});

test('V2 writes structurally verified 16-bit TIFFs with and without the Tint edit', async ({ page }, testInfo) => {
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
  const saveTiff = async () => {
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
    const view = new DataView(bytes.buffer);
    const directory = view.getUint32(4, true);
    for (let i = 0; i < view.getUint16(directory, true); i += 1) {
      const tag = directory + 2 + i * 12;
      if (view.getUint16(tag, true) === 273) {
        return new DataView(bytes.buffer, view.getUint32(tag + 8, true), proof.width * proof.height * 6);
      }
    }
    throw new Error('The TIFF has no pixel strip.');
  };
  const neutral = await saveTiff();
  // Adjust opens with the photo; its rail button toggles, so only open it if it is not already showing.
  const advancedTab = studio.getByRole('tab', { name: 'Advanced Edits' });
  if (!(await advancedTab.isVisible())) await studio.getByRole('button', { name: 'Adjust', exact: true }).click();
  await advancedTab.click();
  const phone = testInfo.project.name === 'phone';
  if (phone) await studio.getByRole('tab', { name: 'Colour', exact: true }).click();
  const tint = studio.getByRole('slider', { name: 'Tint' });
  await expect(tint).toHaveValue('0');
  await tint.fill('80');
  await expect(tint).toHaveValue('80');
  if (phone) await studio.getByRole('button', { name: 'Close mobile drawer' }).click();
  const magenta = await saveTiff();
  let expectedDirection = 0;
  for (let i = 0; i < neutral.byteLength; i += 6) {
    if (magenta.getUint16(i, true) > neutral.getUint16(i, true) &&
        magenta.getUint16(i + 2, true) < neutral.getUint16(i + 2, true) &&
        magenta.getUint16(i + 4, true) > neutral.getUint16(i + 4, true)) expectedDirection += 1;
  }
  expect(expectedDirection).toBeGreaterThan(64 * 96 / 2);
});

test('V2 writes a 16-bit RAW PNG from the sensor data, proven by reading the file back', async ({ page }) => {
  await page.goto('/?v2');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('V2 RAW PNG');
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
    studio.getByRole('button', { name: 'Save 16-bit RAW PNG' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('synthetic-z8_16bit.png');
  const proof = provePng(Uint8Array.from(await readFile((await download.path())!)));
  expect([proof.width, proof.height, proof.bitDepth, proof.colourType, proof.srgb]).toEqual([64, 96, 16, 2, true]);
});

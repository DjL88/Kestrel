import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { mockDesktopBridge } from './desktopBridgeMock';
import { mosaic, withPreview } from './rawFixture';

// Owner report: creating a new project and adding two photographs left a black window.
test('V2 new project: adding two photographs shows the studio, never a blank window', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/?v2');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Two photos');
  await page.getByRole('dialog').getByRole('button', { name: 'Create project', exact: true }).click();
  await studio.getByRole('button', { name: 'Import', exact: true }).waitFor();

  const jpeg = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 900; canvas.height = 600;
    const ctx = canvas.getContext('2d')!;
    for (let y = 0; y < 600; y += 20) for (let x = 0; x < 900; x += 20) {
      ctx.fillStyle = `rgb(${(x * 3) % 255},${(y * 5) % 255},${(x + y) % 255})`;
      ctx.fillRect(x, y, 20, 20);
    }
    return canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  const raw = Buffer.from(withPreview(mosaic, Buffer.from(jpeg, 'base64'))).toString('base64');
  await studio.evaluate((target, files) => {
    const dataTransfer = new DataTransfer();
    for (const [name, base64, type] of files) {
      const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
      dataTransfer.items.add(new File([bytes], name, { type }));
    }
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
  }, [['first.jpg', jpeg, 'image/jpeg'], ['second.dng', raw, 'application/octet-stream']] as const);

  await expect(studio.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(2);
  await expect(studio.getByTestId('canvas-frame').locator('img').first()).toBeVisible();
  await page.waitForTimeout(3000);
  await expect(studio.getByRole('button', { name: 'Import', exact: true })).toBeVisible();
  await expect(studio.getByTestId('canvas-frame').locator('img').first()).toBeVisible();
  expect(errors.filter(text => !/favicon|net::ERR/i.test(text))).toEqual([]);
});

// On the desktop app a large RAW is verified and developed before the full-size view can draw it (many seconds for
// 45 MP). The canvas must show the photo meanwhile, marked as still refreshing, never an empty dark frame.
test('V2 desktop: while a slow RAW develop runs, the canvas shows the photo as refreshing, not a blank frame', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const jpegPath = testInfo.outputPath('preview.jpg');
  const rawPath = testInfo.outputPath('slow-develop.dng');
  await page.goto('/?v2&stub=1');
  const jpeg = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 960; canvas.height = 640;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgb(200,180,120)';
    ctx.fillRect(0, 0, 960, 640);
    return canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
  }), 'base64');
  // Padded to 6 MiB (bytes after the last TIFF directory are never read as image data), so reading it takes time.
  const raw = Buffer.concat([Buffer.from(withPreview(mosaic, jpeg)), Buffer.alloc(6 * 1048576)]);
  await writeFile(jpegPath, jpeg);
  await writeFile(rawPath, raw);

  const page2 = await page.context().newPage();
  await mockDesktopBridge(page2, [rawPath.replace(/\\/g, '/')], {
    developed: { [raw.length]: jpegPath }, developDelayMs: 40_000, readMsPerMebibyte: 2_000,
  });
  await page2.goto('/?v2');
  const studio = page2.locator('.inflight-v2');
  await studio.getByRole('button', { name: 'New project' }).first().click();
  await page2.getByLabel('Project name', { exact: true }).fill('Slow develop');
  await page2.getByRole('dialog').getByRole('button', { name: 'Create project', exact: true }).click();
  await studio.getByRole('button', { name: 'Import', exact: true }).click();
  const photos = studio.getByRole('listbox', { name: 'Project photographs' });
  await expect(photos.getByRole('option')).toHaveCount(1, { timeout: 60_000 });
  await expect(photos.getByRole('img').first()).toBeVisible({ timeout: 30_000 });

  // Once its thumbnail is ready, and long before the full original is verified again and the 40-second develop
  // finishes, the canvas shows the photo (its pale colour), not an empty dark frame.
  const canvasFrame = studio.getByTestId('canvas-frame');
  const brightness = async () => {
    const shot = await canvasFrame.screenshot({ scale: 'css' });
    return page2.evaluate(async (base64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${base64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 32; canvas.height = 32;
      const ctx = canvas.getContext('2d')!;
      // The middle of the frame, away from the frame's edges and handles.
      ctx.drawImage(img, img.width * 0.25, img.height * 0.25, img.width * 0.5, img.height * 0.5, 0, 0, 32, 32);
      const data = ctx.getImageData(0, 0, 32, 32).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
      return sum / (32 * 32 * 3);
    }, shot.toString('base64'));
  };
  await expect.poll(brightness, { timeout: 5_000 }).toBeGreaterThan(100);
  // The develop is still running, so this is the interim picture, and the view says it is still refreshing.
  await expect(canvasFrame.locator('img[data-preview-quality="interim"]')).toBeVisible();
  await expect(canvasFrame.getByRole('status', { name: 'Refreshing image' })).toBeVisible();
  await page2.close();
});

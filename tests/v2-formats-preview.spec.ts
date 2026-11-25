import { expect, test, type Locator, type Page } from '@playwright/test';

// Owner report (25 Nov 2026), V2 Formats:
// - an added format cropped the picture to its own shape, so moving the picture showed black where the photo continues,
//   and the All formats board showed it cut off;
// - edits (exposure) did not reach the formats;
// - Formats opened as a 1:1 Original and corrected itself once the photo's size was measured;
// - All formats lost the picture (a broken image) instead of recovering it.

async function importPhoto(page: Page, root: Locator, name: string, type: 'image/jpeg' | 'image/png') {
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill(`Formats preview ${name}`);
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  // Left half red, right half blue, so a picture moved to show its left edge must show red there, never a dark band.
  const data = await page.evaluate((mime) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200; canvas.height = 800;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgb(200,40,40)'; ctx.fillRect(0, 0, 600, 800);
    ctx.fillStyle = 'rgb(40,40,200)'; ctx.fillRect(600, 0, 600, 800);
    return canvas.toDataURL(mime, 0.92).split(',')[1];
  }, type);
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: 'Import', exact: true }).click();
  await (await chooser).setFiles([{ name, mimeType: type, buffer: Buffer.from(data, 'base64') }]);
  await expect(root.getByTestId('canvas-frame').locator('img').first()).toBeVisible({ timeout: 30_000 });
}

async function includeFormat(root: Locator, label: string) {
  await root.getByRole('button', { name: 'Formats', exact: true }).first().click();
  const toggle = root.getByRole('button', { name: `Include ${label}`, exact: true });
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const close = root.getByRole('button', { name: 'Close Formats panel' });
  if (await close.isVisible()) await close.click();
}

/** True when the shown picture covers the whole box it is drawn in (no empty band at any edge). */
async function pictureCovers(box: Locator) {
  return box.evaluate((element) => {
    const frame = element.getBoundingClientRect();
    const img = [...element.querySelectorAll('img')].find((candidate) => candidate.getAttribute('aria-hidden') !== 'true') as HTMLImageElement | undefined;
    if (!img || !img.complete || img.naturalWidth === 0) return false;
    const picture = img.getBoundingClientRect();
    // 2px: the frame's own 1px border, and sub-pixel layout.
    return picture.left <= frame.left + 2 && picture.right >= frame.right - 2 && picture.top <= frame.top + 2 && picture.bottom >= frame.bottom - 2;
  });
}

/** Mean brightness of a shown picture, read from its pixels. */
async function brightness(img: Locator) {
  return img.evaluate((element: HTMLImageElement) => {
    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(element, 0, 0, 32, 32);
    const data = ctx.getImageData(0, 0, 32, 32).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
    return sum / (data.length / 4) / 3;
  });
}

test('a moved picture in an added format shows more photo, never black, on the canvas and on All formats, and edits reach it', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'Positioning by mouse drag is checked on desktop; the geometry is shared.');
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await importPhoto(page, root, 'formats-pan.jpg', 'image/jpeg');
  await includeFormat(root, 'Instagram Portrait');
  await root.getByRole('button', { name: /All formats/ }).click();
  await root.getByTestId('format-pair-ig-portrait').getByRole('button', { name: /Select/ }).dblclick();

  // Position the picture: drag it right as far as it goes, so its left edge comes into the 4:5 window.
  const frame = root.getByTestId('canvas-frame');
  await expect(root.getByTestId('crop-ghost')).toBeVisible();
  const box = (await frame.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 400, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
  await expect(root.getByTestId('crop-ghost')).toHaveCount(0);

  await expect.poll(() => pictureCovers(frame)).toBe(true);

  // The board draws the same picture, whole and moved the same way.
  await root.getByRole('button', { name: /All formats/ }).click();
  const tile = root.getByTestId('artboard-ig-portrait-0').getByRole('button', { name: /Select/ });
  await expect.poll(() => pictureCovers(tile), { timeout: 15_000 }).toBe(true);
  const tileImg = tile.locator('img').first();
  const before = await brightness(tileImg);

  // An exposure change reaches the format on the board.
  await root.getByRole('button', { name: 'Adjust' }).first().click();
  await root.getByRole('tab', { name: 'Advanced Edits' }).click();
  await root.getByRole('slider', { name: 'Exposure' }).fill('2');
  await expect.poll(async () => (await brightness(root.getByTestId('artboard-ig-portrait-0').locator('img').first())) - before, { timeout: 20_000 }).toBeGreaterThan(15);
  await expect.poll(() => pictureCovers(root.getByTestId('artboard-ig-portrait-0').getByRole('button', { name: /Select/ }))).toBe(true);
});

test('Formats never shows the Original as a 1:1 square while the photo\'s shape is being measured', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  // Record every visible shape the frame takes from the moment the photo arrives.
  await page.evaluate(() => {
    const seen: number[] = [];
    (window as unknown as { __frameShapes: number[] }).__frameShapes = seen;
    const sample = () => {
      const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLElement | null;
      if (frame && frame.dataset.shapePending !== 'true') {
        const rect = frame.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) seen.push(rect.width / rect.height);
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await importPhoto(page, root, 'formats-shape.png', 'image/png');
  await expect(root.getByTestId('canvas-frame')).toBeVisible();
  await page.waitForTimeout(1500);
  const shapes = await page.evaluate(() => (window as unknown as { __frameShapes: number[] }).__frameShapes);
  expect(shapes.length).toBeGreaterThan(0);
  // 1200 × 800 is 3:2; no visible frame was ever square.
  expect(shapes.filter((shape) => Math.abs(shape - 1) < 0.05)).toEqual([]);
  expect(Math.abs(shapes.at(-1)! - 1.5)).toBeLessThan(0.03);
});

test('Formats opens straight on the sizes: no permanent Original pane', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await importPhoto(page, root, 'formats-panel.jpg', 'image/jpeg');
  await root.getByRole('button', { name: 'Formats', exact: true }).first().click();
  await expect(root.getByRole('button', { name: 'Include Instagram Portrait', exact: true })).toBeVisible();
  await expect(root.getByLabel('Original output width')).toHaveCount(0);
  await expect(root.getByText('Original — permanent format')).toHaveCount(0);
});

test('a picture whose address dies is loaded again, showing a picture meanwhile, never a broken image', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await importPhoto(page, root, 'formats-retry.jpg', 'image/jpeg');
  const img = root.getByTestId('canvas-frame').locator('img').first();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), { timeout: 15_000 }).toBe(true);
  // A released or revoked preview address: the browser can no longer load it.
  await img.evaluate((el: HTMLImageElement) => { el.src = 'blob:http://127.0.0.1/expired-preview'; });
  await expect.poll(() => root.getByTestId('canvas-frame').locator('img').first().evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0 && !el.src.endsWith('expired-preview')), { timeout: 15_000 }).toBe(true);
  await expect(root.getByTestId('picture-unavailable')).toHaveCount(0);
});

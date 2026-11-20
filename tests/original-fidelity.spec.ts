import { createHash } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * ROADMAP K.1, "never worse than the original before editing": with no edits, the single-photo view and the editor
 * show the original JPEG itself, at its full size and byte for byte, not a re-encoded or smaller copy. The test photo
 * is larger than the editor's 2200-pixel working canvas, so a redrawn copy would be caught by its size.
 */
const WIDTH = 3000;
const HEIGHT = 2000;

async function detailedJpeg(page: Page): Promise<Buffer> {
  const data = await page.evaluate(([width, height]) => new Promise<string>((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d')!;
    const image = context.createImageData(width, height);
    // Fine, high-contrast detail everywhere: one-pixel lines, a checkerboard and a fixed pseudo-random speckle.
    let seed = 7;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        const at = (y * width + x) * 4;
        const line = x % 3 === 0 ? 200 : 40;
        const check = ((x >> 1) + (y >> 1)) % 2 ? 230 : 25;
        image.data[at] = line;
        image.data[at + 1] = check;
        image.data[at + 2] = seed & 0xff;
        image.data[at + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error('no JPEG')); return; }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.readAsDataURL(blob);
    }, 'image/jpeg', 0.97);
  }), [WIDTH, HEIGHT]);
  return Buffer.from(data, 'base64');
}

/** Natural size and SHA-256 of the bytes behind a shown <img>. */
async function shownPicture(image: Locator) {
  return image.evaluate(async (element: HTMLImageElement) => {
    if (!element.complete) await element.decode();
    const bytes = await (await fetch(element.src)).arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return {
      width: element.naturalWidth,
      height: element.naturalHeight,
      sha256: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''),
    };
  });
}

test('an unedited JPEG is shown as the original itself in single-photo view and in the editor', async ({ page, isMobile }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  const jpeg = await detailedJpeg(page);
  const original = { width: WIDTH, height: HEIGHT, sha256: createHash('sha256').update(jpeg).digest('hex') };

  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Original fidelity');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles({ name: 'detail.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 1' })).toBeVisible({ timeout: 30_000 });

  // Single-photo view: the large picture is the file itself.
  await page.getByRole('button', { name: isMobile ? 'More' : 'Workspace options', exact: true }).click();
  await page.getByRole('combobox', { name: 'View', exact: true }).selectOption('loupe');
  await page.keyboard.press('Escape');
  const loupe = page.locator('[data-photo-stage] img').first();
  await expect(loupe).toBeVisible({ timeout: 30_000 });
  expect(await shownPicture(loupe)).toEqual(original);

  // Editor with no edits: the original is shown over the working canvas, at its full size and unchanged.
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const shown = page.locator('img[data-original-pixels="edited"]');
  await expect(shown).toBeVisible({ timeout: 30_000 });
  expect(await shownPicture(shown)).toEqual(original);
  // It covers exactly the place the drawn picture takes, so nothing moves when an edit begins.
  const canvasBox = await page.getByRole('img', { name: 'Edited photo' }).boundingBox();
  const imageBox = await shown.boundingBox();
  expect(canvasBox && imageBox).toBeTruthy();
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(canvasBox![key] - imageBox![key])).toBeLessThanOrEqual(1);

  // The first real edit shows the processed picture instead; taking it back to zero brings the original back.
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  const allControls = page.getByRole('button', { name: 'All controls' });
  if (await allControls.isVisible()) await allControls.click();
  const slider = page.getByRole('slider', { name: 'Noise reduction adjustment' });
  await slider.focus();
  await slider.press('End');
  await expect(slider).toHaveValue('2');
  await expect(shown).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Edited photo' })).toBeVisible();
  await slider.press('Home');
  await expect(slider).toHaveValue('0');
  await expect(shown).toBeVisible();
});

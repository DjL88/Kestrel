import { createHash } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * ROADMAP K.1, "never worse than the original before editing": with no edits, both sides of the editor comparison
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

test('both sides of a neutral comparison show the full original JPEG', async ({ page }) => {
  await page.goto('/');
  const jpeg = await detailedJpeg(page);
  const original = { width: WIDTH, height: HEIGHT, sha256: createHash('sha256').update(jpeg).digest('hex') };
  await page.getByTestId('quick-edit-input').setInputFiles({ name: 'detail.jpg', mimeType: 'image/jpeg', buffer: jpeg });

  const edited = page.getByRole('img', { name: 'Edited photo' });
  await expect(edited).toHaveJSProperty('tagName', 'IMG');
  expect(await shownPicture(edited)).toEqual(original);

  await page.keyboard.press('Backslash');
  const before = page.getByRole('img', { name: 'Original photo' });
  await expect(before).toBeVisible();
  await expect(before).toHaveJSProperty('tagName', 'IMG');
  await expect(edited).toHaveJSProperty('tagName', 'IMG');
  expect(await shownPicture(before)).toEqual(original);
  expect(await shownPicture(edited)).toEqual(original);
});

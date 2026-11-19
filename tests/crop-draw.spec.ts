import { expect, test, type Page } from '@playwright/test';

async function openCrop(page: Page) {
  await page.goto('/');
  const picture = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 600;
    const c = canvas.getContext('2d')!; c.fillStyle = '#3d5568'; c.fillRect(0, 0, 900, 600);
    c.fillStyle = '#d9a441'; c.fillRect(300, 200, 300, 200);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByTestId('quick-edit-input').setInputFiles({ name: 'crop.png', mimeType: 'image/png', buffer: Buffer.from(picture, 'base64') });
  const photo = page.getByRole('img', { name: 'Edited photo' });
  await expect(photo).toBeVisible({ timeout: 20000 });
  await page.getByRole('tab', { name: 'Crop' }).click();
  await expect(page.locator('.crop-guide')).toBeVisible();
  return { photo: (await photo.boundingBox())!, guide: page.locator('.crop-guide') };
}

const near = (a: number, b: number, tolerance = 3) => Math.abs(a - b) <= tolerance;

test('drawing on the photo with the mouse makes a new crop box', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'drawing is for a mouse or pen; touch keeps pinch and pan and uses the handles');
  const { photo, guide } = await openCrop(page);
  const ratio = page.getByRole('combobox', { name: 'Crop aspect ratio' });
  await expect(ratio).toHaveValue('');

  const from = { x: photo.x + photo.width * 0.2, y: photo.y + photo.height * 0.25 };
  const to = { x: photo.x + photo.width * 0.7, y: photo.y + photo.height * 0.6 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();

  const box = (await guide.boundingBox())!;
  expect(near(box.x, from.x) && near(box.y, from.y), JSON.stringify(box)).toBe(true);
  expect(near(box.width, to.x - from.x) && near(box.height, to.y - from.y), JSON.stringify(box)).toBe(true);
  await expect(ratio).toHaveValue('free');

  // A click on the photo is not a drag: the crop stays.
  await page.mouse.click(photo.x + photo.width * 0.9, photo.y + photo.height * 0.9);
  const after = (await guide.boundingBox())!;
  expect(near(after.width, box.width) && near(after.height, box.height)).toBe(true);
});

test('any edge can be pulled in, and a chosen ratio is kept', async ({ page }) => {
  const { photo, guide } = await openCrop(page);
  const top = page.getByRole('button', { name: /Crop edge, top/ });
  await expect(top).toBeVisible();
  const start = (await guide.boundingBox())!;

  // Open shape: only the top edge moves.
  for (let i = 0; i < 10; i += 1) await top.press('ArrowDown');
  const pulled = (await guide.boundingBox())!;
  expect(pulled.y).toBeGreaterThan(start.y + 10);
  expect(near(pulled.y + pulled.height, start.y + start.height)).toBe(true);
  expect(near(pulled.width, start.width)).toBe(true);
  await expect(page.getByRole('combobox', { name: 'Crop aspect ratio' })).toHaveValue('free');

  // Square chosen: pulling the left edge keeps the box square and the right edge in place.
  await page.getByRole('combobox', { name: 'Crop aspect ratio' }).selectOption({ label: 'Square' });
  const square = (await guide.boundingBox())!;
  const left = page.getByRole('button', { name: /Crop edge, left/ });
  const handle = (await left.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + photo.width * 0.1, handle.y + handle.height / 2, { steps: 5 });
  await page.mouse.up();
  const kept = (await guide.boundingBox())!;
  expect(kept.width).toBeLessThan(square.width - 10);
  expect(near(kept.width, kept.height), JSON.stringify(kept)).toBe(true);
  expect(near(kept.x + kept.width, square.x + square.width)).toBe(true);
});

import { expect, test, type Page } from '@playwright/test';

test.skip(({ viewport }) => (viewport?.width ?? 1280) < 768, 'crop dragging is exercised on desktop; touch gestures differ on phone');

async function openInEditor(page: Page) {
  await page.goto('/');
  const picture = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 320;
    const c = canvas.getContext('2d')!; const g = c.createLinearGradient(0, 0, 480, 320);
    g.addColorStop(0, 'hsl(10,60%,40%)'); g.addColorStop(1, 'hsl(220,60%,70%)'); c.fillStyle = g; c.fillRect(0, 0, 480, 320);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Crop tool');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles({ name: 'gradient.png', mimeType: 'image/png', buffer: Buffer.from(picture, 'base64') });
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 1' })).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Crop' }).click();
  await expect(page.getByRole('img', { name: 'Edited photo' })).toBeVisible({ timeout: 30000 });
}

test('with no aspect ratio chosen, the crop box starts as the whole photo', async ({ page }) => {
  await openInEditor(page);
  const photoBox = (await page.getByRole('img', { name: 'Edited photo' }).boundingBox())!;
  const guide = (await page.locator('.crop-guide').boundingBox())!;
  expect(Math.abs(guide.width - photoBox.width)).toBeLessThan(2);
  expect(Math.abs(guide.height - photoBox.height)).toBeLessThan(2);
});

test('dragging anywhere on the photo draws a brand new crop box from scratch', async ({ page }) => {
  await openInEditor(page);
  const photoBox = (await page.getByRole('img', { name: 'Edited photo' }).boundingBox())!;
  const guideBefore = (await page.locator('.crop-guide').boundingBox())!;
  // Start the drag well inside the photo, nowhere near an existing corner handle.
  await page.mouse.move(photoBox.x + photoBox.width * 0.2, photoBox.y + photoBox.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(photoBox.x + photoBox.width * 0.75, photoBox.y + photoBox.height * 0.6, { steps: 8 });
  await page.mouse.up();
  const guideAfter = (await page.locator('.crop-guide').boundingBox())!;
  // The freshly drawn box is smaller than the full-photo starting box, roughly where the drag went.
  expect(guideAfter.width).toBeLessThan(guideBefore.width - 10);
  expect(guideAfter.height).toBeLessThan(guideBefore.height - 10);
  expect(guideAfter.x).toBeGreaterThan(photoBox.x);
  expect(guideAfter.y).toBeGreaterThan(photoBox.y);
});

test('once an aspect ratio is chosen, a fresh drag keeps that ratio instead of the drag\'s own shape', async ({ page }) => {
  await openInEditor(page);
  await page.getByLabel('Aspect ratio').selectOption('1');
  const guideSquare = (await page.locator('.crop-guide').boundingBox())!;
  expect(Math.abs(guideSquare.width - guideSquare.height)).toBeLessThan(2);
  const photoBox = (await page.getByRole('img', { name: 'Edited photo' }).boundingBox())!;
  // Drag a wide, short rectangle - very unlike a square - starting outside the current (now smaller) box.
  await page.mouse.move(photoBox.x + 4, photoBox.y + photoBox.height - 4);
  await page.mouse.down();
  await page.mouse.move(photoBox.x + photoBox.width - 4, photoBox.y + photoBox.height * 0.55, { steps: 8 });
  await page.mouse.up();
  const guideAfter = (await page.locator('.crop-guide').boundingBox())!;
  // Still square: the locked ratio won, not the wide shape that was dragged.
  expect(Math.abs(guideAfter.width - guideAfter.height)).toBeLessThan(2);
});

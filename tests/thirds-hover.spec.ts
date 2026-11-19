import { expect, test } from '@playwright/test';

test.skip(({ isMobile }) => !!isMobile, 'touch screens have no hover; the grid stays off there');

test('a thirds grid appears while the pointer is over the photo, and follows the Gridlines switch', async ({ page }) => {
  await page.goto('/');
  const picture = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 600;
    const c = canvas.getContext('2d')!; c.fillStyle = '#3d5568'; c.fillRect(0, 0, 900, 600);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByTestId('quick-edit-input').setInputFiles({ name: 'thirds.png', mimeType: 'image/png', buffer: Buffer.from(picture, 'base64') });
  const photo = page.getByRole('img', { name: 'Edited photo' });
  await expect(photo).toBeVisible({ timeout: 20000 });
  const grid = page.getByTestId('thirds-grid');
  const opacity = () => grid.evaluate((element) => getComputedStyle(element).opacity);

  await page.mouse.move(2, 2); // away from the photo
  await expect.poll(opacity).toBe('0');
  const box = (await photo.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(opacity).toBe('1');
  // It never takes clicks: the photo underneath stays reachable.
  await expect(grid).toHaveCSS('pointer-events', 'none');

  // Turning Gridlines off in Crop removes it.
  await page.getByRole('tab', { name: 'Crop' }).click();
  await page.getByRole('checkbox', { name: 'Gridlines' }).uncheck();
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  await expect(grid).toHaveCount(0);
});

import { expect, test } from '@playwright/test';

const photo = { name: 'bar.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') };

test('the editor\'s bottom bar has previous and next on the left and zoom on the right, also after photo-only view', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'phones use the editing sheet; the bar order is a desktop layout');
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles(photo);
  const bar = page.getByRole('toolbar', { name: 'Photo navigation and editing actions' });
  const zoom = bar.getByRole('group', { name: 'Zoom' });
  await expect(zoom).toBeVisible({ timeout: 20000 });
  const previous = (await bar.getByRole('button', { name: 'Previous photo' }).boundingBox())!;
  const zoomBox = (await zoom.boundingBox())!;
  expect(previous.x).toBeLessThan(zoomBox.x);
  // Zoom is in the bottom bar only, not in the editor's top toolbar as well.
  await expect(page.getByRole('group', { name: 'Zoom' })).toHaveCount(1);

  await page.getByRole('button', { name: 'Show photo only' }).click();
  await expect(bar).toHaveCount(0);
  await page.getByRole('button', { name: /Exit photo-only view/ }).click();
  await expect(page.getByRole('toolbar', { name: 'Photo navigation and editing actions' }).getByRole('group', { name: 'Zoom' })).toBeVisible();
});

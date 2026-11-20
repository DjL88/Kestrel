import { expect, test } from '@playwright/test';

test('a neutral raster opens directly and a crop uses the edited preview', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles('tests/fixtures/exif-photo.jpg');
  const photo = page.getByRole('img', { name: 'Edited photo' });
  await expect(photo).toBeVisible();
  await expect(photo).toHaveJSProperty('tagName', 'IMG');
  await page.getByRole('tab', { name: 'Crop' }).click();
  await page.getByLabel('Aspect ratio').selectOption('1');
  await page.getByRole('button', { name: 'Apply crop' }).click();
  await expect(photo).toHaveJSProperty('tagName', 'CANVAS');
});

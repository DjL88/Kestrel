import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('Before/After can compare a previous edit and a chosen history stage without restoring edits', async ({ page }) => {
  test.skip(test.info().project.name === 'phone', 'desktop editing controls used in this regression');
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles({
    name: 'history.jpg', mimeType: 'image/jpeg',
    buffer: readFileSync('src/assets/images/demo_red_kite_flight_1794721996053.jpg'),
  });
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  const exposure = page.getByRole('slider', { name: 'Light adjustment' });
  const warmth = page.getByRole('slider', { name: 'Warmth adjustment' });
  await exposure.press('ArrowRight');
  await warmth.press('ArrowRight');
  const beforeAfter = page.getByRole('button', { name: /Before \/ After/ });
  await beforeAfter.click();
  const picker = page.getByRole('combobox', { name: 'Before comparison stage' });
  await expect(picker).toBeVisible();
  await expect(picker.locator('option[value="last-export"]')).toBeDisabled();
  await picker.selectOption('previous');
  await expect(page.getByText('Edit 1', { exact: true })).toBeVisible();
  await expect(exposure).toHaveValue('0.1');
  await expect(warmth).toHaveValue('0.1');
  await picker.selectOption('original');
  await expect(page.getByRole('img', { name: 'Original photo' })).toBeVisible();
  await picker.selectOption('step:1');
  await expect(page.getByText('Edit 1', { exact: true })).toBeVisible();
  // Comparison must never undo a slider change.
  await expect(exposure).toHaveValue('0.1');
  await expect(warmth).toHaveValue('0.1');
  await beforeAfter.click();
  await expect(picker).toHaveCount(0);
});

import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('slider never keeps the previous exposure after Undo and Reset', async ({ page }) => {
  test.skip(test.info().project.name === 'phone', 'desktop editor; phone quick-adjust is covered elsewhere');
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles({
    name: 'sliders.jpg', mimeType: 'image/jpeg',
    buffer: readFileSync('src/assets/images/demo_red_kite_flight_1794721996053.jpg'),
  });
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  const exposure = page.getByRole('slider', { name: 'Exposure adjustment' });
  await expect(exposure).toHaveValue('0');
  await exposure.press('ArrowRight');
  await expect(exposure).toHaveValue('0.1');
  // The former reconciliation timer could leave the old value visible ~350 ms.
  await page.getByRole('toolbar', { name: 'Editor actions' }).getByRole('button', { name: 'Undo' }).click();
  await expect(exposure).toHaveValue('0', { timeout: 250 });
  await exposure.press('ArrowRight');
  await expect(exposure).toHaveValue('0.1');
  const reset = page.getByRole('button', { name: /Reset Exposure/i });
  await reset.click();
  await expect(exposure).toHaveValue('0', { timeout: 250 });
  await expect(reset).toBeDisabled();
});

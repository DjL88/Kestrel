import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const demoPhoto = readFileSync('src/assets/images/demo_red_kite_flight_1794721996053.jpg');

test('Brightness is separate from Exposure, responds and can be undone', async ({ page }) => {
  test.skip(test.info().project.name === 'phone', 'Desktop editor sliders are shown directly; phone uses the quick-adjust sheet.');
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles({
    name: 'brightness-workflow.jpg', mimeType: 'image/jpeg', buffer: demoPhoto,
  });
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  const exposure = page.getByRole('slider', { name: 'Exposure adjustment' });
  const brightness = page.getByRole('slider', { name: 'Brightness adjustment' });
  await expect(exposure).toHaveValue('0');
  await expect(brightness).toHaveValue('0');
  await expect(brightness).toHaveAttribute('title', /midtone brightness/i);

  await brightness.focus();
  await brightness.press('ArrowRight');
  await expect(brightness).toHaveValue('0.05');
  await expect(exposure).toHaveValue('0', 'Brightness must not modify photographic EV');
  await page.getByRole('toolbar', { name: 'Editor actions' }).getByRole('button', { name: 'Undo' }).click();
  await expect(brightness).toHaveValue('0');
  await expect(exposure).toHaveValue('0');
});

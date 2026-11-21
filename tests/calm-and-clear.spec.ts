import { expect, test } from '@playwright/test';

test('Calm and clear turns the comfort options on together, and tapping it again undoes them', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  const dialog = page.getByRole('dialog').first();
  const preset = dialog.getByRole('button', { name: /^Calm and clear/ });
  await expect(preset).toHaveAttribute('aria-pressed', 'false');
  await preset.click();
  const html = page.locator('html');
  await expect(preset).toHaveAttribute('aria-pressed', 'true');
  await expect(html).toHaveAttribute('data-text-size', '125');
  await expect(html).toHaveAttribute('data-font', 'readable');
  await expect(html).toHaveAttribute('data-calm', 'true');
  await expect(html).toHaveAttribute('data-spacing', 'roomy');
  // It survives a reload, because it is stored on the device.
  await page.reload();
  await expect(html).toHaveAttribute('data-spacing', 'roomy');
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  const again = page.getByRole('dialog').first().getByRole('button', { name: /^Calm and clear/ });
  // Changing one part leaves the preset but keeps the rest.
  await page.getByRole('dialog').first().getByLabel('Standard', { exact: true }).check();
  await expect(again).toHaveAttribute('aria-pressed', 'false');
  await expect(html).toHaveAttribute('data-text-size', '125');
  await again.click();
  await again.click();
  await expect(html).toHaveAttribute('data-text-size', '100');
  await expect(html).toHaveAttribute('data-calm', 'false');
});

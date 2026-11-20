import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const photo = readFileSync('src/assets/images/demo_red_kite_flight_1794721996053.jpg');

test('Suggest a look has one short status and keeps the technical explanation tucked away', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles({
    name: 'kestrel-suggestion.jpg', mimeType: 'image/jpeg', buffer: photo,
  });
  await page.getByRole('tab', { name: 'Auto' }).click();
  const advice = page.getByRole('tabpanel', { name: 'Auto' });
  const help = advice.locator('details').filter({ hasText: 'How suggestions work' });
  await expect(help).toHaveCount(1);
  await expect(help).not.toHaveAttribute('open');
  await expect(help.getByText(/checks the whole picture/)).not.toBeVisible();
  await help.locator('summary').click();
  await expect(help.getByText(/checks the whole picture/)).toBeVisible();
  // No repetitive always-visible checklist before a suggestion is requested.
  await expect(advice.locator('ul[role="status"]')).toHaveCount(0);
});

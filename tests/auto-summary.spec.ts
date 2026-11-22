import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const photo = readFileSync('src/assets/images/demo_red_kite_flight_1794721996053.jpg');

test('Auto has one short headline and keeps the measurements tucked away', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles({
    name: 'kestrel-suggestion.jpg', mimeType: 'image/jpeg', buffer: photo,
  });
  await page.getByRole('tab', { name: 'Auto' }).click();
  const advice = page.getByRole('tabpanel', { name: 'Auto' });
  // Nothing is shown before Auto is asked for.
  await expect(advice.getByTestId('auto-headline')).toHaveCount(0);
  await advice.getByRole('button', { name: 'Auto', exact: true }).click();
  await expect(advice.getByTestId('auto-headline')).toBeVisible({ timeout: 60_000 });
  // The outcome is a word as well as an icon, never colour alone.
  await expect(advice.getByTestId('auto-headline')).toContainText(/Improved|Looks good|Cannot improve safely/);
  const measured = advice.locator('details').filter({ hasText: 'What was measured' });
  await expect(measured).toHaveCount(1);
  await expect(measured).not.toHaveAttribute('open');
});

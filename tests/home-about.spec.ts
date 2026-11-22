import { expect, test } from '@playwright/test';
import packageMetadata from '../package.json' with { type: 'json' };

test('home footer shows product-led About copy and current application version', async ({ page }) => {
  await page.goto('/');
  const footer = page.locator('footer[aria-label="About InFlight"]');
  await expect(footer).toBeVisible();
  // About is a bar at the bottom of the screen; it opens on tap.
  await footer.getByRole('button', { name: 'About InFlight' }).click();
  await expect(footer.getByText('Thoughtful photo culling and editing, built around a simpler workflow and respect for your originals.')).toBeVisible();
  await expect(footer.getByText(`Version ${packageMetadata.version}`)).toBeVisible();
  await expect(footer).not.toContainText('founder');
  await expect(footer).not.toContainText('DjL88');
});

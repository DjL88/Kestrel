import { expect, test } from '@playwright/test';
import { version } from '../package.json';

test('home footer shows product-led About copy and current application version', async ({ page }) => {
  await page.goto('/');
  const footer = page.getByRole('contentinfo', { name: 'About Kestrel' });
  await expect(footer).toBeVisible();
  await expect(footer.getByText('Thoughtful photo culling and editing, built around a simpler workflow and respect for your originals.')).toBeVisible();
  await expect(footer.getByText(`Version ${version}`)).toBeVisible();
  await expect(footer).not.toContainText('founder');
  await expect(footer).not.toContainText('DjL88');
});

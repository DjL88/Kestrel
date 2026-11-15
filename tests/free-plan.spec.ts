import { expect, test } from '@playwright/test';
import { openExportDialog } from './helpers';

// These run against a build made with VITE_KESTREL_PLAN=free (see docs/COMMERCIAL-RELEASE.md). Normal builds are fully open.
test.skip(process.env.KESTREL_PLAN_PREVIEW !== 'free', 'needs the Free-plan build');

const photo = () => ({ name: 'free.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });

test('Free: editing opens on Edit, and the Auto and Masks tabs say they are part of Paid', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles(photo());
  await expect(page.getByRole('tab', { name: 'Edit' })).toHaveAttribute('aria-selected', 'true', { timeout: 15000 });
  await page.getByRole('tab', { name: 'Auto' }).click();
  await expect(page.getByRole('heading', { name: 'The Auto tab is part of Kestrel Paid' })).toBeVisible();
  await expect(page.getByText('Identify birds and animals')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Masks' }).click();
  await expect(page.getByRole('heading', { name: 'Masks and subject detection is part of Kestrel Paid' })).toBeVisible();
  await page.getByRole('tab', { name: 'Edit' }).click();
  await expect(page.getByRole('slider').first()).toBeVisible();
});

test('Free: the tenth export of the day is allowed, and after that exporting says why and when it resets', async ({ page }) => {
  await page.goto('/');
  const now = new Date();
  const day = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  await page.evaluate((today) => localStorage.setItem('kestrel.exportsToday.v1', JSON.stringify({ day: today, count: 10 })), day);
  expect(now.getFullYear()).toBeGreaterThan(2000);
  await page.getByTestId('quick-edit-input').setInputFiles(photo());
  await openExportDialog(page);
  await page.getByRole('button', { name: 'Instagram' }).click();
  await page.getByRole('checkbox', { name: /Post · 4:5/ }).check();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: /^Prepare 1 file/ }).click();
  await expect(page.getByText(/used today's 10 free exports/)).toBeVisible();
});

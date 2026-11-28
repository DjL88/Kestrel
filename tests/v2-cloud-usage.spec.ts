import { test, expect } from '@playwright/test';
import { openHubSettings } from './hubSettings';

/** Plans and cloud allowances (owner, 25 Nov 2026): Settings → Account shows the three meters, the reset date and the balance. */
test('?v2 sample account shows cloud photos, storage and downloads against the free allowances', async ({ page }) => {
  await page.goto('/?v2&stub=1');
  await openHubSettings(page);
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('tab', { name: 'Account' }).click();
  await expect(settings.getByTestId('v2-cloud-usage')).toHaveCount(0);
  await settings.getByRole('button', { name: /Google/ }).first().click();
  const panel = settings.getByTestId('v2-cloud-usage');
  await expect(panel.getByRole('heading', { name: 'Cloud usage' })).toBeVisible();
  await expect(panel.getByTestId('cloud-meter-photos')).toContainText('1,840 of 5,000');
  await expect(panel.getByTestId('cloud-meter-storage')).toContainText('4.1 GB of 2.5 GB');
  await expect(panel.getByTestId('cloud-meter-storage')).toContainText('£0.12 this month beyond the free amount');
  await expect(panel.getByTestId('cloud-storage-plan')).toContainText('100.0 GB for £6.99 a month by Direct Debit');
  await expect(panel.getByTestId('cloud-storage-plan')).toContainText('about 100,000 photos as previews, or 3,200 with 25 MP RAW originals, or 9,000 with 25 MP JPEG originals');
  await expect(panel.getByTestId('cloud-storage-holds')).toContainText('2.5 GB holds about 2,500 photos as previews, or 80 with 25 MP RAW originals');
  await expect(panel.getByTestId('cloud-meter-downloads')).toContainText('420 MB of 1.0 GB');
  await expect(panel).toContainText('Cloud balance: £5.00');
  await expect(panel.getByRole('button', { name: 'Top up £5.00' })).toBeDisabled();
});

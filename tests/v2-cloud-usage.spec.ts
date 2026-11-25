import { test, expect } from '@playwright/test';

/** Plans and cloud allowances (owner, 25 Nov 2026): Settings → Account shows the three meters, the reset date and the balance. */
test('?v2 sample account shows cloud photos, storage and downloads against the free allowances', async ({ page }) => {
  await page.goto('/?v2&stub=1');
  await page.locator('.inflight-v2').getByRole('button', { name: 'Settings', exact: true }).first().click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('tab', { name: 'Account' }).click();
  await expect(settings.getByTestId('v2-cloud-usage')).toHaveCount(0);
  await settings.getByRole('button', { name: /Google/ }).first().click();
  const panel = settings.getByTestId('v2-cloud-usage');
  await expect(panel.getByRole('heading', { name: 'Cloud usage' })).toBeVisible();
  await expect(panel.getByTestId('cloud-meter-photos')).toContainText('1,840 of 5,000');
  await expect(panel.getByTestId('cloud-meter-storage')).toContainText('4.1 GB of 2.5 GB');
  await expect(panel.getByTestId('cloud-meter-storage')).toContainText('£0.12 this month beyond the free amount');
  await expect(panel.getByTestId('cloud-meter-downloads')).toContainText('420 MB of 1.0 GB');
  await expect(panel).toContainText('Cloud balance: £5.00');
  await expect(panel.getByRole('button', { name: 'Top up £5.00' })).toBeDisabled();
});

import { test, expect } from '@playwright/test';

/**
 * #703: Settings > AI providers lists the on-device models with their pinned digests. In the browser the vision model is
 * desktop-only, and no load time, memory or speed is ever shown that this device did not measure.
 */
test('?v2 Settings lists on-device models without invented numbers', async ({ page }) => {
  await page.goto('/?v2');
  await page.locator('.inflight-v2').getByRole('button', { name: 'Settings', exact: true }).first().click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('tab', { name: 'AI providers' }).click();
  const section = settings.getByTestId('v2-model-metrics');
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByRole('heading', { name: 'Models on this device' })).toBeVisible();
  await expect(section.getByTestId('v2-model-metrics-desktop-only')).toBeVisible();
  await expect(section.getByTestId('v2-model-measure')).toHaveCount(0);
  const pack = section.getByTestId('v2-model-pack-efficientsam-ti-fp16');
  await expect(pack).toContainText('5f0260b1');
  await expect(pack).toContainText('not measured for this pack yet');
  await expect(section.getByText(/\d+(\.\d+)? (ms|s)\b/)).toHaveCount(0);
});

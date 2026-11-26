import { expect, test } from '@playwright/test';

test('?v2 offline shows a small crossed-out cloud with the word Offline, not a full-width bar', async ({ page, context }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await expect(root.getByRole('button', { name: 'New project' }).first()).toBeVisible();
  await expect(root.getByTestId('offline-status')).toHaveCount(0);
  await context.setOffline(true);
  const cloud = root.getByTestId('cloud-status');
  await expect(cloud).toHaveAttribute('data-state', 'offline');
  await expect(cloud).toContainText('Offline');
  await expect(cloud).toHaveAccessibleName(/Offline\. InFlight cannot reach it right now/);
  if (test.info().project.name === 'desktop') await page.screenshot({ path: test.info().outputPath('hub-offline.png') });
  await context.setOffline(false);
  await expect(root.getByTestId('cloud-status').filter({ hasText: 'Offline' })).toHaveCount(0);
});

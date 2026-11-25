import { expect, test } from '@playwright/test';

test('?v2 Share opens a calm dialog that explains what is shared and needs no account until used', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Share check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  await root.getByTestId('share-button').click();
  const dialog = page.getByTestId('share-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Share this project' })).toBeVisible();
  await expect(dialog).toContainText('until you choose to send photos');
  // This build has no control plane or sign-in, so it says so instead of failing silently.
  await expect(dialog.getByRole('alert')).toHaveText(/not available in this version|Sign in/);
  await expect(root.getByTestId('presence-avatars')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(root.getByTestId('share-button')).toBeFocused();
});

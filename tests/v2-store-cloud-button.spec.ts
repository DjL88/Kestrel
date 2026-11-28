import { expect, test } from '@playwright/test';
import { openV2Settings } from './helpers';

// Dave, 27 Nov: the top bar's Share button is now "Store in the cloud", shown only for a signed-in Pro account; signed
// out or Basic there is no button there at all, and Export stays its own button. At a limit it says "Full · Top up",
// which opens Settings › Account. Checked on the demo workspace, whose sample Pro account is over its 2.5 GB.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The header buttons are the same on every screen; checked once.');
});

test('?v2 Store in the cloud appears only once signed in as Pro, beside its own limit note, with Export unchanged', async ({ page }) => {
  await page.goto('/?v2&stub=1');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: /Open studio/ }).first().click();
  const header = root.getByRole('banner');
  await expect(header.getByRole('button', { name: 'Export' })).toBeVisible();
  await expect(header.getByTestId('store-cloud-button'), 'signed out: no button').toHaveCount(0);
  await expect(header.getByTestId('share-button'), 'sharing with people is paused').toHaveCount(0);
  await expect(header.getByTestId('cloud-limit-full')).toHaveCount(0);

  // Sign in as the sample Pro account (12.1 GB stored against 10 GB included).
  await openV2Settings(page);
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('tab', { name: 'Account' }).click();
  await settings.getByRole('button', { name: /Google/ }).first().click();
  await expect(settings.getByTestId('cloud-meter-storage')).toContainText('12.1 GB of 10.0 GB');
  await page.getByRole('button', { name: 'Close settings' }).click();

  const store = header.getByTestId('store-cloud-button');
  await expect(store).toBeVisible();
  await expect(store).toHaveAccessibleName('Store in the cloud');
  await expect(header.getByRole('button', { name: 'Export' })).toBeVisible();
  // At the limit: said in words, and it leads to where it is fixed. Never colour alone.
  const full = header.getByTestId('cloud-limit-full');
  await expect(full).toHaveText('Full · Top up');
  await full.click();
  await expect(page.getByRole('dialog', { name: 'Settings' }).getByTestId('v2-cloud-usage')).toBeVisible();
  await page.getByRole('button', { name: 'Close settings' }).click();

  // The button opens the chooser. Reachable and closable from the keyboard.
  await store.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByTestId('store-cloud-dialog');
  await expect(dialog.getByRole('heading', { name: 'Store in the cloud' })).toBeVisible();
  await expect(dialog.getByTestId('store-cloud-filter').getByRole('radio')).toHaveCount(5);
  // Focus stays inside the dialog, and returns to the button that opened it.
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(store).toBeFocused();
});

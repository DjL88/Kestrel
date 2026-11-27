import { openV2Settings, openFlightChecks } from './helpers';
import { expect, test } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop tool rail.');
});

async function openEditor(page: import('@playwright/test').Page) {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Hide Pro check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 200; c.height = 100;
    c.getContext('2d')!.fillRect(0, 0, 200, 100);
    return c.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'pro-hide-1.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  return root;
}

test('?v2 Basic: the on-device checks (Auto pick, Deep Vision Review) are offered and never hidden as Pro', async ({ page }) => {
  const root = await openEditor(page);
  await expect(root.getByRole('button', { name: /Auto pick/ })).toBeVisible();
  await root.getByRole('button', { name: /Co-pilot|Flight|Solo|Auto-pilot/ }).first().click();
  // Deep Vision Review runs on this device, so a Basic account can use it, offline too (Dave, 27 Nov: Pro was told it was not on the plan).
  await openFlightChecks(root);
  await expect(root.getByRole('button', { name: /Deep Vision Review/ })).toBeEnabled();
  await expect(root.getByText(/Not available on this plan/)).toHaveCount(0);

  await openV2Settings(page);
  await page.getByRole('tab', { name: 'Appearance' }).or(page.getByRole('button', { name: 'Appearance' })).first().click();
  const toggle = page.getByRole('switch', { name: 'Hide Pro features' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Close settings' }).click();
  // Auto pick is an on-device model, so it is Basic (owner decision 13) and is never hidden as Pro.
  await expect(root.getByRole('button', { name: /Auto pick/ })).toBeVisible();
  await openFlightChecks(root);
  await expect(root.getByRole('button', { name: /Deep Vision Review/ })).toBeEnabled();

  await openV2Settings(page);
  await page.getByRole('tab', { name: 'Appearance' }).or(page.getByRole('button', { name: 'Appearance' })).first().click();
  await page.getByRole('switch', { name: 'Hide Pro features' }).click();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await openFlightChecks(root);
  await expect(root.getByRole('button', { name: /Deep Vision Review/ })).toBeEnabled();
});

test('?v2 hiding a tool in Panels & layout takes it off the rail (not greyed), and it can be shown again from the menu', async ({ page }) => {
  const root = await openEditor(page);
  const rail = root.locator('aside').first();
  await expect(rail.getByRole('button', { name: 'Formats' })).toBeVisible();
  await rail.getByRole('button', { name: 'Formats' }).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Panels & layout' });
  await menu.getByRole('button', { name: 'Formats' }).click();
  await expect(rail.getByRole('button', { name: 'Formats' })).toHaveCount(0);
  await expect(menu.getByRole('button', { name: 'Formats' })).toBeVisible(); // still listed, so it can come back
  await menu.getByRole('button', { name: 'Formats' }).click();
  await expect(rail.getByRole('button', { name: 'Formats' })).toBeVisible();
});

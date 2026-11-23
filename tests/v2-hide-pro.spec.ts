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

test('?v2 Basic: Hide Pro features removes auto-cull and the online review block, and switching it off brings them back', async ({ page }) => {
  const root = await openEditor(page);
  await expect(root.getByRole('button', { name: /Auto-Cull/ })).toBeVisible();
  await root.getByRole('button', { name: /Co-pilot|Flight|Solo|Auto-pilot/ }).first().click();
  await expect(root.getByText(/Online review is unavailable/)).toBeVisible();

  await root.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Appearance' }).or(page.getByRole('button', { name: 'Appearance' })).first().click();
  const toggle = page.getByRole('switch', { name: 'Hide Pro features' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(root.getByRole('button', { name: /Auto-Cull/ })).toHaveCount(0);
  await expect(root.getByText(/Online review is unavailable/)).toHaveCount(0);

  await root.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Appearance' }).or(page.getByRole('button', { name: 'Appearance' })).first().click();
  await page.getByRole('switch', { name: 'Hide Pro features' }).click();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(root.getByRole('button', { name: /Auto-Cull/ })).toBeVisible();
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

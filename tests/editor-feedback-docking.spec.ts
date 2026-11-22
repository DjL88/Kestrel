import { expect, test } from '@playwright/test';

test('desktop editor undocks, resizes with keyboard, and docks its tool without hiding the workspace', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'Floating panels are deliberately replaced by a bottom sheet on phones.');
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Docking smoke test');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();

  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#777777'; ctx.fillRect(0, 0, 128, 128);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles({
    name: 'dock.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64'),
  });
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();

  await page.getByRole('tab', { name: 'Edit', exact: true }).click({ button: 'right' });
  await page.getByTestId('tab-context-menu').getByRole('menuitem', { name: 'Undock Edit' }).click();
  const pane = page.locator('[data-floating-pane]').filter({ hasText: 'Edit' });
  await expect(pane).toBeVisible();
  // A floating tab leaves the strip entirely; docking it brings it back.
  await expect(page.getByRole('tab', { name: 'Edit', exact: true })).toHaveCount(0);
  const grip = pane.locator('[data-pane-resize-handle]');
  await expect(grip).toBeVisible();
  const before = await pane.boundingBox();
  await grip.focus();
  await grip.press('ArrowRight');
  const after = await pane.boundingBox();
  expect(before && after && after.width > before.width).toBeTruthy();

  await pane.getByRole('button', { name: /^Dock Edit$/ }).click();
  await expect(pane).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Edit', exact: true })).toBeVisible();
});

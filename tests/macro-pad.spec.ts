import { expect, test } from '@playwright/test';

test('browser and phone menus stay focused and do not advertise desktop macro-pad hardware', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Macro pad test');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: page.viewportSize()!.width < 768 ? 'More' : 'Workspace options', exact: true }).click();
  const menu = page.locator('#workspace-options');
  await expect(menu.getByRole('button', { name: /Macro pad/i })).toHaveCount(0);
  await expect(menu.getByText('Appearance & layout', { exact: true })).toBeVisible();
});

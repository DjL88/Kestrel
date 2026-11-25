import { expect, test } from '@playwright/test';

test('V2 desktop File/Edit/View menus are keyboard-operable and return focus on Escape', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'Desktop application menus are hidden on narrow screens');
  await page.goto('/?v2&stub=1');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: /Scottish Highlands/ }).first().click();
  const navigation = root.getByRole('navigation', { name: /application menus/i });
  const file = navigation.getByRole('button', { name: 'File', exact: true });
  await file.click();
  const menu = navigation.getByRole('menu');
  await expect(menu).toBeVisible();
  const enabled = menu.getByRole('menuitem').filter({ visible: true });
  await expect(enabled.first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(enabled.last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(enabled.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(enabled.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(enabled.first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(file).toBeFocused();
});

test('V2 menu shortcut labels are the keys the editor runs, never fixed Mac glyphs on other systems', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'Desktop application menus are hidden on narrow screens');
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'Win32' }));
  await page.goto('/?v2&stub=1');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: /Scottish Highlands/ }).first().click();
  const navigation = root.getByRole('navigation', { name: /application menus/i });
  await navigation.getByRole('button', { name: 'Edit', exact: true }).click();
  const menu = navigation.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: /Undo/ })).toContainText('Ctrl');
  await expect(menu).not.toContainText('⌘');
  // Clear selection has no key in V2, so the menu must not promise one.
  await expect(menu.getByRole('menuitem', { name: /Clear selection/i })).not.toContainText('Esc');
  await page.keyboard.press('Escape');
  await navigation.getByRole('button', { name: 'File', exact: true }).click();
  await expect(navigation.getByRole('menu')).not.toContainText('⌘');
});

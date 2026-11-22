import { expect, test, type Locator, type Page } from '@playwright/test';

// Desktop-sized window with touch: the tablet case, where there is no right mouse button.
test.skip(({ viewport }) => (viewport?.width ?? 0) < 1100, 'tablet and desktop layouts only; phones use the bottom sheet');

async function openEditor(page: Page) {
  await page.goto('/');
  const picture = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 120;
    const c = canvas.getContext('2d')!; c.fillStyle = '#456'; c.fillRect(0, 0, 160, 120);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Dock menu');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles({ name: 'dock.png', mimeType: 'image/png', buffer: Buffer.from(picture, 'base64') });
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 1' })).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Crop' })).toBeVisible();
}

async function press(target: Locator, type: 'touch' | 'mouse', holdMs: number, moveBy = 0) {
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const init = (cx: number) => ({ pointerType: type, pointerId: 7, isPrimary: true, clientX: cx, clientY: y, bubbles: true });
  await target.dispatchEvent('pointerdown', init(x));
  if (moveBy) await target.dispatchEvent('pointermove', init(x + moveBy));
  await target.page().waitForTimeout(holdMs);
  await target.dispatchEvent('pointerup', init(x + moveBy));
}

test('right-clicking an editor tab lists every tab with icon toggles to hide or undock it', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('tab', { name: 'Crop' }).click({ button: 'right' });
  const menu = page.getByTestId('tab-context-menu');
  await expect(menu).toBeVisible();
  // The tab that was clicked is marked, and each row has an eye (hide) and a dock toggle.
  await expect(menu.locator('[data-current="true"]')).toContainText('Crop');
  await expect(menu.getByRole('menuitem', { name: 'Hide Crop' }).locator('svg')).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Undock Crop' }).click();
  await expect(menu).toBeHidden();
  // The menu lists every tab, like the View menu. The tab that was clicked is marked, and a floating tab shows Dock.
  await page.getByRole('tab', { name: 'Auto' }).click({ button: 'right' });
  const all = page.getByTestId('tab-context-menu');
  await expect(all.getByRole('menuitem', { name: 'Undock Auto' })).toBeVisible();
  await expect(all.getByRole('menuitem', { name: 'Hide Edit' })).toBeVisible();
  await expect(all.getByText('Floating')).toBeVisible();
  await expect(all.getByRole('menuitem', { name: 'Dock Crop' })).toBeVisible();
  // A floating tab leaves the tab strip completely.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tab', { name: 'Crop' })).toHaveCount(0);
});

test('a touch long-press on a tab opens the same menu, and the press does not also select the tab', async ({ page }) => {
  await openEditor(page);
  const crop = page.getByRole('tab', { name: 'Crop' });
  await press(crop, 'touch', 650);
  await expect(page.getByTestId('tab-context-menu')).toBeVisible();
  await expect(crop).toHaveAttribute('aria-selected', 'false');
  await page.keyboard.press('Escape');
});

test('a short touch tap still selects the tab, and a drag or a mouse hold opens nothing', async ({ page }) => {
  await openEditor(page);
  const crop = page.getByRole('tab', { name: 'Crop' });
  await press(crop, 'touch', 650, 40);
  await press(crop, 'mouse', 650);
  await expect(page.getByTestId('tab-context-menu')).toHaveCount(0);
  await crop.click();
  await expect(crop).toHaveAttribute('aria-selected', 'true');
});

test('Photo info has the same right-click and long-press menu, with Undock and Hide', async ({ page }) => {
  await openEditor(page);
  const title = page.locator('[data-info-menu-target]').first();
  await title.click({ button: 'right' });
  const menu = page.getByTestId('info-context-menu');
  await expect(menu.getByRole('menuitem', { name: 'Undock Photo Info' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Hide Photo info' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await press(title, 'touch', 650);
  await expect(page.getByTestId('info-context-menu')).toBeVisible();
  await page.getByTestId('info-context-menu').getByRole('menuitem', { name: 'Undock Photo Info' }).click();
  await expect(page.getByRole('button', { name: /Dock Photo info/i }).first()).toBeVisible();
});

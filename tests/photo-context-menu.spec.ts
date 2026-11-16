import { expect, test, type Page } from '@playwright/test';

test.skip(({ viewport }) => (viewport?.width ?? 1280) < 768, 'right-click is a desktop interaction');

async function project(page: Page) {
  await page.goto('/');
  const pictures = await page.evaluate(() => Array.from({ length: 3 }, (_, index) => {
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 300;
    const c = canvas.getContext('2d')!; c.fillStyle = `rgb(${60 + index * 40},90,120)`; c.fillRect(0, 0, 400, 300);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Menus');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles(pictures.map((data, i) => ({ name: `m-${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') })));
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 3' })).toBeVisible({ timeout: 30000 });
}

const collections = (page: Page) => page.getByRole('navigation', { name: 'Photo collections' });

test('right-click on a photo in the library opens a menu of actions that work', async ({ page }) => {
  await project(page);
  const card = page.getByRole('button', { name: 'View m-1.png' });
  await card.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'm-1.png' });
  await expect(menu).toBeVisible();
  // The first available action has focus, and the arrow keys move through the rest.
  await expect(menu.getByRole('menuitem', { name: 'Edit photo' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Photo info' })).toBeFocused();
  // Nothing has been copied, and this photo has no adjustments, so those are greyed out.
  await expect(menu.getByRole('menuitem', { name: 'Paste adjustments' })).toBeDisabled();
  await expect(menu.getByRole('menuitem', { name: 'Copy adjustments' })).toBeDisabled();
  // Keep it.
  await menu.getByRole('menuitem', { name: 'Keep', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(collections(page).getByRole('button', { name: 'Keepers 1' })).toBeVisible();
});

test('Escape closes the menu and returns focus to the photo; the menu never opens off screen', async ({ page }) => {
  await project(page);
  const card = page.getByRole('button', { name: 'View m-2.png' });
  await card.focus();
  await card.click({ button: 'right', position: { x: 5, y: 5 } });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  const view = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(view.width);
  expect(box.y + box.height).toBeLessThanOrEqual(view.height);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(card).toBeFocused();
});

test('rating, Photo info and Export from the menu', async ({ page }) => {
  await project(page);
  await page.getByRole('button', { name: 'View m-3.png' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rate 4 stars' }).click();
  await page.getByRole('button', { name: 'View m-3.png' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Photo info' }).click();
  await expect(page.getByRole('group', { name: 'Star rating, 4 of 5' })).toBeVisible();
  await page.getByRole('button', { name: 'Close photo info' }).click();
  await page.getByRole('button', { name: 'View m-3.png' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Export/ }).click();
  await expect(page.getByRole('dialog').first()).toBeVisible();
});

test('the filmstrip has the same menu, and moving a photo to the Trash from it asks nothing for a photo not yet kept', async ({ page }) => {
  await project(page);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('tab', { name: 'Crop' }).waitFor();
  await page.getByRole('button', { name: 'Jump to frame m-2.png' }).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'm-2.png' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Move to Trash' }).click();
  await expect(menu).toHaveCount(0);
});

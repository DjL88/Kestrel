import { expect, test } from '@playwright/test';
import { createDemoShootState } from '../src/core/cullingEngine';
import { encodeProjectBackup } from '../src/core/projectBackup';
import { DEFAULT_EDIT } from '../src/core/photoEdits';

test('the single-photo bar says what each action is, and More offers reset edit and duplicate', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The words show from 360 px wide; the 320 px layout is covered by single-photo-culling.spec.ts');
  const project = createDemoShootState(1);
  project.shoot.title = 'Photo bar fixture';
  project.filter = 'all';
  project.frames[0].edit = { ...DEFAULT_EDIT, exposure: 0.5 };

  await page.goto('/');
  await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles({
    name: 'fixture.kestrel.json', mimeType: 'application/json', buffer: Buffer.from(encodeProjectBackup(project)),
  });
  await page.getByRole('button', { name: 'All photos 1', exact: true }).click();
  await page.getByRole('button', { name: 'Workspace options', exact: true }).click();
  await page.getByRole('combobox', { name: 'View', exact: true }).selectOption('loupe');

  const controls = page.getByRole('group', { name: 'Single photo controls' });
  // Every action in the bar has a visible word, not only an icon.
  await expect(controls.getByRole('button', { name: /^Keep / })).toContainText('Keep');
  await expect(controls.getByRole('button', { name: /^Move .* to Trash/ })).toContainText('Trash');
  await expect(controls.getByRole('button', { name: /^Reset .* to original/ })).toContainText('Reset edit');
  await expect(controls.getByRole('button', { name: /^More actions/ })).toContainText('More');
  await page.keyboard.press('k');
  await expect(controls.getByRole('button', { name: 'Undo last decision' })).toContainText('Undo');

  // More opens the same menu as a right-click, with Reset edit and Duplicate in it.
  await controls.getByRole('button', { name: /^More actions/ }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: /^Reset edit/ })).toBeEnabled();
  await expect(menu.getByRole('menuitem', { name: 'Duplicate (virtual copy)' })).toBeEnabled();
  await menu.getByRole('menuitem', { name: 'Duplicate (virtual copy)' }).click();
  await expect(page.getByText(/Made a virtual copy/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'All photos 2', exact: true })).toBeVisible();

  // The copy has its own edit; reset it from the menu and the Reset button goes away (nothing left to reset).
  await controls.getByRole('button', { name: /^More actions/ }).click();
  await page.getByRole('menuitem', { name: /^Reset edit/ }).click();
  await expect(controls.getByRole('button', { name: /^Reset .* to original/ })).toHaveCount(0);
  await controls.getByRole('button', { name: /^More actions/ }).click();
  await expect(page.getByRole('menuitem', { name: /^Reset edit/ })).toBeDisabled();
});

import { expect, test } from '@playwright/test';

// G08: photos move to another project from the filmstrip's photo menu. The move itself is unit-tested in
// src/core/projects.test.ts (moveFrames); this checks the menu, the choice of project and the result shown.
test('?v2 filmstrip: Move to project… offers the other projects and takes the photo out of this one', async ({ page }) => {
  await page.goto('/?v2&stub=1&autostart=1');
  const root = page.locator('.inflight-v2');
  const strip = root.getByRole('listbox', { name: 'Project photographs' });
  await expect(strip.getByRole('option').first()).toBeVisible();
  const before = await strip.getByRole('option').count();

  await strip.getByRole('option').first().click({ button: 'right' });
  await root.getByRole('menu', { name: 'Photo actions' }).getByRole('menuitem', { name: 'Move to project…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Move to another project' });
  await expect(dialog).toContainText('Their choices and edits go with them.');
  const targets = dialog.getByTestId('move-targets').getByRole('button');
  await expect(targets.first()).toBeVisible();
  const target = (await targets.first().innerText()).trim();

  // Cancel changes nothing.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(strip.getByRole('option')).toHaveCount(before);

  await strip.getByRole('option').first().click({ button: 'right' });
  await root.getByRole('menu', { name: 'Photo actions' }).getByRole('menuitem', { name: 'Move to project…' }).click();
  await page.getByRole('dialog', { name: 'Move to another project' }).getByRole('button', { name: target, exact: true }).click();
  await expect(strip.getByRole('option')).toHaveCount(before - 1);
  await expect(root.getByText(`Moved to “${target}”: 1.`)).toBeVisible();
});

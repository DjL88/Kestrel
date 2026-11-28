import { expect, test } from '@playwright/test';

// Phone home page (owner brief, 28 Nov): Privacy, Terms, Back up and Settings sit behind one ⋯ menu, there is no footer,
// New project is one full-width button fixed to the bottom, the search box takes the row with an icon-only sort, a
// project's menu opens in front of everything, and the New project dialog starts with the name and has no folder button.
test('phone home page: side menu, bottom New project, no footer, project menu in front', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Phone layout only.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?v2&stub=1');
  const root = page.locator('.inflight-v2');

  // No footer and no loose header buttons: the ⋯ button holds them.
  await expect(root.locator('footer')).toBeHidden();
  await expect(root.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
  await root.getByTestId('hub-menu-button').click();
  const menu = page.getByTestId('hub-menu');
  for (const name of ['Settings', 'Restore from backup…']) await expect(menu.getByRole('button', { name })).toBeVisible();
  for (const name of ['Privacy', 'Terms']) await expect(menu.getByRole('link', { name })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  // New project: one full-width button at the bottom of the screen.
  const bar = root.getByTestId('hub-new-project-bar').getByRole('button', { name: 'New project' });
  const box = (await bar.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(390 - 40);
  expect(box.y + box.height, 'fixed to the bottom').toBeGreaterThan(844 - 40);
  expect(box.height).toBeGreaterThanOrEqual(44);

  // Sort is an icon (44px square) and the search box takes the rest of its row.
  const sort = (await root.getByTestId('project-sort').boundingBox())!;
  expect(sort.width).toBeLessThanOrEqual(48);
  const search = (await root.getByRole('searchbox').boundingBox())!;
  expect(search.width).toBeGreaterThan(150);

  // A project's ⋯ menu is in front of the bar and every neighbour.
  await root.getByRole('button', { name: /^Project actions for / }).first().click();
  const projectMenu = root.getByRole('menu').first();
  await expect(projectMenu).toBeVisible();
  const front = await projectMenu.evaluate((node) => {
    const r = node.getBoundingClientRect();
    return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) && r.bottom <= window.innerHeight;
  });
  expect(front, 'the menu is in front and on screen').toBe(true);
});

test('phone New project dialog: name first, no folder button, buttons clear of the corners', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Phone layout only.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?v2&stub=1');
  const root = page.locator('.inflight-v2');
  await root.getByTestId('hub-new-project-bar').getByRole('button', { name: 'New project' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create new project' });
  const name = (await dialog.getByLabel('Project name').boundingBox())!;
  const kind = (await dialog.getByTestId('project-kind-photography').boundingBox())!;
  expect(name.y, 'the name is above the kind choice').toBeLessThan(kind.y);
  await expect(dialog.getByRole('button', { name: /folder/i })).toHaveCount(0);
  const create = (await dialog.getByRole('button', { name: 'Create project' }).boundingBox())!;
  const panel = (await dialog.locator('form').boundingBox())!;
  expect(panel.y + panel.height - (create.y + create.height), 'margin under the buttons').toBeGreaterThanOrEqual(12);
  expect(panel.x + panel.width - (create.x + create.width), 'margin to the right corner').toBeGreaterThanOrEqual(12);
});

test('desktop home page keeps the footer and the header buttons', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop layout only.');
  await page.goto('/?v2&stub=1');
  const root = page.locator('.inflight-v2');
  await expect(root.locator('footer')).toBeVisible();
  await expect(root.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await expect(root.getByTestId('hub-menu-button')).toBeHidden();
  await expect(root.getByTestId('hub-new-project-bar')).toBeHidden();
});

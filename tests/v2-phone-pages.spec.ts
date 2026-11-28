import { expect, test } from '@playwright/test';

// The phone has two pages (owner brief, 28 Nov): a grid of every photo in the project, and the editor for one photo.
// No filmstrip. A tap on a photo opens it for editing; Back from the editor returns to the grid; Back from the grid
// returns to the projects. Import, filter, sort, search and the rest are behind one ⋯ menu in the grid's header.
test('phone: project opens on a photo grid; a tap opens the editor; Back returns to the grid, then the projects', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Phone layout only.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?v2&stub=1');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: 'Cairngorms Pinewood Stags', exact: true }).click();

  // Page one: the grid. No filmstrip and no tool bar.
  const grid = studio.getByTestId('phone-grid-page');
  await expect(grid).toBeVisible();
  await expect(studio.getByRole('listbox', { name: 'Project photographs' })).toHaveCount(0);
  await expect(studio.getByRole('navigation', { name: 'Mobile studio tools' })).toHaveCount(0);
  const tiles = grid.getByTestId('phone-grid-tile');
  await expect(tiles).toHaveCount(20);
  const tile = (await tiles.first().boundingBox())!;
  expect(tile.width, 'three across').toBeGreaterThan(100);
  expect(tile.width).toBeLessThan(140);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  // A tap on a photo opens it: page two, with the tool bar and no grid.
  await tiles.first().getByRole('button').first().tap();
  await expect(grid).toHaveCount(0);
  await expect(studio.getByTestId('phone-photo-title')).toContainText(/1 of 20/);
  await expect(studio.getByRole('navigation', { name: 'Mobile studio tools' })).toBeVisible();
  await expect(studio.getByRole('listbox', { name: 'Project photographs' })).toHaveCount(0);

  // Back from one photo is the grid; Back from the grid is the projects.
  await studio.getByRole('button', { name: /^Back/ }).first().tap();
  await expect(studio.getByTestId('phone-grid-page')).toBeVisible();
  await studio.getByTestId('phone-grid-page').getByRole('button', { name: 'Back to projects' }).tap();
  await expect(studio.getByRole('heading', { name: 'Projects' })).toBeVisible();
});

test('phone grid header menu: import, filter, sort and search are one tap from the title bar', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Phone layout only.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?v2&stub=1');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: 'Cairngorms Pinewood Stags', exact: true }).click();
  const grid = studio.getByTestId('phone-grid-page');
  await grid.getByTestId('phone-grid-menu-button').tap();
  const menu = grid.getByTestId('phone-grid-menu');
  await expect(menu.getByRole('menuitem', { name: 'Import photos' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Auto pick/ })).toBeVisible();
  await expect(menu.getByTestId('phone-grid-sort')).toBeVisible();
  // Every row in the menu is a finger-sized target.
  for (const row of await menu.getByRole('menuitem').all()) expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  await menu.getByTestId('phone-grid-filter-flagged').tap();
  await expect(grid.getByTestId('phone-grid-tile')).toHaveCount(6);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  await grid.getByTestId('phone-grid-search-toggle').tap();
  await expect(grid.getByTestId('phone-grid-search')).toBeVisible();
});

test('desktop keeps the filmstrip and the toolbar', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop layout only.');
  await page.goto('/?v2&stub=1');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: /Open studio/ }).first().click();
  await expect(studio.getByTestId('phone-grid-page')).toHaveCount(0);
  await expect(studio.getByRole('listbox', { name: 'Project photographs' })).toBeVisible();
});

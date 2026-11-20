import { expect, test, type Page } from '@playwright/test';

test.skip(({ viewport }) => (viewport?.width ?? 1280) < 768, 'exercised on desktop; the consolidated control also renders in the phone menu');

async function project(page: Page, names: string[]) {
  await page.goto('/');
  const pictures = await page.evaluate((count) => Array.from({ length: count }, (_, i) => {
    const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 90;
    const c = canvas.getContext('2d')!; c.fillStyle = `hsl(${i * 70}, 60%, 45%)`; c.fillRect(0, 0, 120, 90);
    return canvas.toDataURL('image/png').split(',')[1];
  }), names.length);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Filter and sort');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles(
    pictures.map((data, i) => ({ name: names[i], mimeType: 'image/png', buffer: Buffer.from(data, 'base64') }))
  );
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: `To review ${names.length}` }))
    .toBeVisible({ timeout: 30000 });
}

test('the Filter control starts closed, and opening it narrows the grid by search', async ({ page }) => {
  await project(page, ['zebra.png', 'mango.png', 'apple.png']);
  // Locate by the stable aria-controls attribute, not accessible name: the name itself changes once a filter
  // count badge appears ("Filter" -> "Filter 1"), and "Filter" alone would also match "Clear filters".
  const filterButton = page.locator('button[aria-controls="filter-popover"]');
  await expect(filterButton).toBeVisible();
  // Decluttered: the search box and rating control are not sitting open in the bar by default.
  await expect(page.getByPlaceholder('Subject name or filename')).toHaveCount(0);
  await filterButton.click();
  const search = page.getByPlaceholder('Subject name or filename');
  await expect(search).toBeVisible();
  await search.fill('mango');
  await expect(page.getByLabel('Frame mango.png')).toBeVisible();
  await expect(page.getByLabel('Frame zebra.png')).toHaveCount(0);
  await expect(page.getByLabel('Frame apple.png')).toHaveCount(0);
  // The button itself now shows how many filters are active.
  await expect(filterButton).toContainText('1');
});

test('sorting by name reorders the grid without touching the filter', async ({ page }) => {
  await project(page, ['zebra.png', 'mango.png', 'apple.png']);
  const frameOrder = () => page.locator('[aria-label^="Frame "]').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label')));
  // The catalogue's own import order isn't something this test should assume (import may order by capture
  // time, which these plain synthetic PNGs don't carry) - just capture whatever it actually is.
  await expect.poll(frameOrder).toHaveLength(3);
  const catalogueOrder = await frameOrder();
  await page.getByLabel('Sort photos').selectOption('name-asc');
  await expect.poll(frameOrder).toEqual(['Frame apple.png', 'Frame mango.png', 'Frame zebra.png']);
  // Back to the catalogue's own order when "as imported" is chosen again.
  await page.getByLabel('Sort photos').selectOption('default');
  await expect.poll(frameOrder).toEqual(catalogueOrder);
});

test('sort selector has a visible icon before the selected value', async ({ page }) => {
  await project(page, ['bird.png']);
  const control = page.getByRole('combobox', { name: 'Sort photos' });
  await expect(control).toBeVisible();
  const label = page.locator('label').filter({ has: control });
  await expect(label.locator('svg')).toHaveCount(1);
});

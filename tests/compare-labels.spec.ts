import { expect, test } from '@playwright/test';

test('compare identifies both photos and updates the names when swapped', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Compare test');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  const png = await page.evaluate(() => document.createElement('canvas').toDataURL().split(',')[1]);
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles(['kestrel-a.png', 'kestrel-b.png'].map((name) => ({
    name, mimeType: 'image/png', buffer: Buffer.from(png, 'base64'),
  })));
  await page.getByRole('button', { name: page.viewportSize()!.width < 768 ? 'More' : 'Workspace options', exact: true }).click();
  await page.getByRole('combobox', { name: 'View', exact: true }).selectOption('compare');

  const a = page.getByTestId('compare-photo-a');
  const b = page.getByTestId('compare-photo-b');
  await expect(a).toHaveText('A · kestrel-a.png');
  await expect(b).toHaveText('B · kestrel-b.png');
  for (const label of [a, b]) expect((await label.boundingBox())!.width).toBeGreaterThan(60);
  await page.getByRole('button', { name: 'Swap photos A and B' }).click();
  await expect(a).toHaveText('A · kestrel-b.png');
  await expect(b).toHaveText('B · kestrel-a.png');
  const compare = page.getByRole('region', { name: 'Compare photos' });
  const zoom = compare.getByRole('button', { name: 'Zoom in', exact: true });
  await expect(zoom).toHaveText('Zoom in');
  expect((await zoom.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await zoom.click();
  const fit = compare.getByRole('button', { name: 'Fit photo', exact: true });
  await expect(fit).toHaveText('Fit photo');
  await fit.press('Enter');
  await expect(zoom).toHaveText('Zoom in');
});

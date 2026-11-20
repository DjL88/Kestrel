import { expect, test } from '@playwright/test';

test('compare identifies both photos and updates the names when swapped', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Compare test');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  const png = await page.evaluate(() => document.createElement('canvas').toDataURL().split(',')[1]);
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles(['kestrel-a.png', 'kestrel-b.png', 'kestrel-c.png'].map((name) => ({
    name, mimeType: 'image/png', buffer: Buffer.from(png, 'base64'),
  })));
  await page.getByRole('button', { name: page.viewportSize()!.width < 768 ? 'More' : 'Workspace options', exact: true }).click();
  await page.getByRole('combobox', { name: 'View', exact: true }).selectOption('compare');

  const a = page.getByTestId('compare-photo-a');
  const b = page.getByTestId('compare-photo-b');
  await expect(a).toContainText('kestrel-a.png');
  await expect(b).toContainText('kestrel-b.png'); // then its place in the queue, e.g. (1 of 2)
  for (const label of [a, b]) expect((await label.boundingBox())!.width).toBeGreaterThan(60);
  await page.getByRole('button', { name: 'Swap photos A and B' }).click();
  await expect(a).toContainText('kestrel-b.png');
  await expect(b).toContainText('kestrel-a.png');
  const compare = page.getByRole('region', { name: 'Compare photos' });
  const previous = compare.getByRole('button', { name: 'Previous photo B' });
  const next = compare.getByRole('button', { name: 'Next photo B' });
  await expect(previous).toBeDisabled();
  await next.click();
  await expect(a).toContainText('kestrel-b.png');
  await expect(b).toContainText('kestrel-c.png');
  await expect(next).toBeDisabled();
  await previous.click();
  await expect(b).toContainText('kestrel-a.png');

  const zoom = compare.getByRole('button', { name: 'Zoom in', exact: true });
  await expect(zoom).toHaveText('Zoom in');
  expect((await zoom.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await zoom.press('Enter');
  const fit = compare.getByRole('button', { name: 'Fit photo', exact: true });
  await expect(fit).toHaveText('Fit photo');
  await expect(fit).toBeFocused();
  const photoA = compare.getByRole('img', { name: 'kestrel-b.png' });
  const photoB = compare.getByRole('img', { name: 'kestrel-a.png' });
  await expect(photoA).toBeVisible();
  await expect(photoB).toBeVisible();
  const originalA = (await photoA.boundingBox())!;
  const originalB = (await photoB.boundingBox())!;
  await fit.press('ArrowRight');
  await expect.poll(async () => (await photoA.boundingBox())!.x).toBeLessThan(originalA.x);
  await expect.poll(async () => (await photoB.boundingBox())!.x).toBeLessThan(originalB.x);
  await expect(a).toContainText('kestrel-b.png');
  await expect(b).toContainText('kestrel-a.png');
  await fit.press('Enter');
  await expect(zoom).toHaveText('Zoom in');
});

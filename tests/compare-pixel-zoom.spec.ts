import { expect, test } from '@playwright/test';

test.skip(({ viewport }) => (viewport?.width ?? 1280) < 768,
  'Desktop Compare pixel-zoom test; mobile sheet requires a separate measured touch run');

test('Compare uses localised photo recovery and true 100% and 200% preview zoom', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => localStorage.setItem('kestrel-language', 'en-GB'));
  await page.goto('/');
  const images = await page.evaluate(() => [0, 1].map((index) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 1000;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = index ? '#456789' : '#987654';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png').split(',')[1];
  }));

  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Compare with correct pixel zoom');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles(images.map((data, index) => ({
    name: `compare-${index + 1}.png`,
    mimeType: 'image/png',
    buffer: Buffer.from(data, 'base64'),
  })));
  await expect(page.getByRole('navigation', { name: 'Photo collections' })
    .getByRole('button', { name: 'To review 2' })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Workspace options', exact: true }).click();
  await page.getByRole('combobox', { name: 'View', exact: true }).selectOption('compare');

  const compare = page.getByRole('region', { name: 'Compare photos' });
  await expect(compare).toBeVisible();
  const choose = compare.getByRole('button', { name: 'Choose the next photo' });
  if (await choose.isVisible().catch(() => false)) await choose.click();
  const oneToOne = compare.getByRole('button', { name: 'View photo B at 100% of its available preview pixels' });
  await expect(oneToOne).toBeEnabled({ timeout: 30_000 });
  await oneToOne.click();
  await expect(oneToOne).toHaveAttribute('aria-pressed', 'true');
  const pixelZoom = compare.getByRole('button', {
    name: 'View photo B at 200% of its available preview pixels',
  });
  await expect(pixelZoom).toBeEnabled({ timeout: 30_000 });
  await pixelZoom.click();
  await expect(pixelZoom).toHaveAttribute('aria-pressed', 'true');
  await expect(oneToOne).toHaveAttribute('aria-pressed', 'false');

  // "2× Fit" is deliberately not offered under a misleading 200% name.
  await expect(compare.getByRole('button', { name: 'Zoom both photos to twice fitted size' })).toHaveCount(0);
  await expect(compare.locator('[data-compare-main] img')).toHaveCount(1);
});

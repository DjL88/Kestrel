import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// Wholly synthetic (tests/fixtures/make_heic_fixture.py): 96 x 64, red left, blue right, green square top-left.
const heic = readFileSync('tests/fixtures/synthetic-heic.heic');

/** The colour at (x, y) of a loaded <img>, read through a canvas. */
const colourAt = (page: Page, testId: string, x: number, y: number) => page.getByTestId(testId).evaluate((node, [px, py]) => {
  const img = node as HTMLImageElement;
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const context = canvas.getContext('2d')!;
  context.drawImage(img, 0, 0);
  return Array.from(context.getImageData(px, py, 1, 1).data.slice(0, 3));
}, [x, y]);

const near = (actual: number[], expected: number[]) => actual.every((value, i) => Math.abs(value - expected[i]) <= 45);

test('a HEIC photo imports into a project, shows in the grid and opens in the editor at full size', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('HEIC test');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  const input = page.getByTestId('local-file-input');
  // The picker offers HEIF photos by extension and by type, on every platform.
  expect(await input.getAttribute('accept')).toMatch(/\.heic.*\.heif.*\.hif.*image\/heic/);
  await input.setInputFiles([
    { name: 'IMG_0001.HEIC', mimeType: 'image/heic', buffer: heic },
    // Cut short, as a failed copy would leave it: kept in the project, never faked, and said so plainly.
    { name: 'IMG_0002.HEIC', mimeType: 'image/heic', buffer: heic.subarray(0, heic.length - 200) },
  ]);

  const collections = page.getByRole('navigation', { name: 'Photo collections' });
  await expect(collections.getByRole('button', { name: 'To review 2' })).toBeVisible({ timeout: 20_000 });
  const tile = page.getByRole('img', { name: 'IMG_0001.HEIC', exact: true }).first();
  await expect(tile).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => tile.evaluate((img) => (img as HTMLImageElement).naturalWidth), { timeout: 20_000 }).toBeGreaterThan(0);
  await expect(page.getByText('Kestrel could not decode this HEIF photo. The original is unchanged.').first()).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Keep IMG_0001.HEIC', exact: true }).click();
  await collections.getByRole('button', { name: 'Keepers 1' }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Exposure adjustment' })).toBeEnabled({ timeout: 20_000 });
  const photo = page.getByRole('img', { name: 'Edited photo' });
  await expect(photo).toBeVisible();
  // Full size, never a downsampled preview.
  await expect.poll(() => photo.evaluate((node) => node instanceof HTMLImageElement ? [node.naturalWidth, node.naturalHeight] : [0, 0]))
    .toEqual([96, 64]);
});

test('a HEIC opened for a quick edit shows its own pixels, the right way up', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles({ name: 'IMG_0001.HEIC', mimeType: 'image/heic', buffer: heic });
  const photo = page.getByRole('img', { name: 'Edited photo' });
  await expect(photo).toBeVisible({ timeout: 20_000 });
  await expect(photo).toHaveJSProperty('tagName', 'IMG');
  await photo.evaluate((node) => { node.setAttribute('data-testid', 'heic-photo'); });
  await expect.poll(() => photo.evaluate((node) => [(node as HTMLImageElement).naturalWidth, (node as HTMLImageElement).naturalHeight])).toEqual([96, 64]);
  expect(near(await colourAt(page, 'heic-photo', 4, 4), [30, 200, 60])).toBe(true);
  expect(near(await colourAt(page, 'heic-photo', 10, 40), [220, 30, 30])).toBe(true);
  expect(near(await colourAt(page, 'heic-photo', 80, 40), [30, 60, 220])).toBe(true);
  await expect(page.getByText(/could not decode this HEIF/)).toHaveCount(0);
});

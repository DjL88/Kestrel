import { expect, test, type Page } from '@playwright/test';
import { openExportDialog } from './helpers';
import { DETAIL_CONTROLS, EDIT_CHOICES, TONE_CONTROLS, applyDetail, applyPhotoEdit, hasDetail, type PhotoEdit } from '../src/core/photoEdits';

/** The whole recipe as the editor's sliders show it (labels map back to recipe keys). */
async function readRecipe(page: Page): Promise<PhotoEdit> {
  const values = await page.locator('input[type=range][aria-label$=" adjustment"]').evaluateAll((inputs) =>
    inputs.map((input) => [input.getAttribute('aria-label')!.replace(/ adjustment$/, ''), Number((input as HTMLInputElement).value)] as const));
  const byLabel = new Map(values);
  const edit: Record<string, number> = { exposure: 0, warmth: 0, colour: 0 };
  for (const { key, label } of [...EDIT_CHOICES, ...TONE_CONTROLS, ...DETAIL_CONTROLS]) {
    const value = byLabel.get(label);
    if (value) edit[key] = value;
  }
  return edit as unknown as PhotoEdit;
}

/**
 * Kestrel Next, Slice 2: the whole photographer's journey in one test, on one project.
 * Import mixed files → keep / trash → Auto on unedited keepers → a manual adjustment → full-size export at the
 * source's true dimensions → leave, reload, reopen with every decision and edit intact.
 * Synthetic fixtures only. The real-file version of this run is `npm run journey:local` (never committed).
 */

/** Textured synthetic photos made in the page: a dark one Auto should lift, a normal one, a bright JPEG. */
async function makeFixtures(page: Page) {
  return page.evaluate(async () => {
    const make = async (name: string, width: number, height: number, base: number, type: string) => {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const c = canvas.getContext('2d')!;
      const image = c.createImageData(width, height);
      let seed = width * 31 + base;
      const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        const texture = 10 * Math.sin(x * 0.9 + y * 0.35) + 6 * Math.sin(y * 1.1) + (random() - 0.5) * 4;
        const v = base + texture + (x / width) * 12;
        const i = (y * width + x) * 4;
        image.data[i] = v + 6; image.data[i + 1] = v; image.data[i + 2] = v - 4; image.data[i + 3] = 255;
      }
      c.putImageData(image, 0, 0);
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), type, 0.95));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { name, mimeType: type, data: btoa(binary) };
    };
    return Promise.all([
      make('j-1-dark.png', 1500, 1000, 30, 'image/png'),
      make('j-2-normal.png', 1200, 800, 115, 'image/png'),
      make('j-3-bright.jpg', 1000, 1500, 200, 'image/jpeg'),
      make('j-4-extra.png', 900, 600, 120, 'image/png'),
    ]);
  });
}

test('journey: import, cull, Auto, adjust, full-size export, reopen', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'desktop journey; the phone editor uses a folded sheet (Slice 4)');
  test.setTimeout(150_000);
  await page.goto('/');

  // 1. Import.
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Journey');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  const fixtures = await makeFixtures(page);
  await page.getByTestId('local-file-input').setInputFiles(fixtures.map((f) => ({ name: f.name, mimeType: f.mimeType, buffer: Buffer.from(f.data, 'base64') })));
  const collections = page.getByRole('navigation', { name: 'Photo collections' });
  await expect(collections.getByRole('button', { name: 'To review 4' })).toBeVisible({ timeout: 30_000 });

  // 2. Review and cull: two keepers, one to Trash, one left to review.
  await page.getByRole('button', { name: 'Keep j-1-dark.png', exact: true }).click();
  await page.getByRole('button', { name: 'Keep j-3-bright.jpg', exact: true }).click();
  await page.getByRole('button', { name: 'Move j-4-extra.png to Trash', exact: true }).click();
  const confirmTrash = page.getByRole('alertdialog');
  if (await confirmTrash.isVisible().catch(() => false)) await confirmTrash.getByRole('button', { name: /Trash|Move/ }).first().click();
  await expect(collections.getByRole('button', { name: 'Keepers 2', exact: true })).toBeVisible();
  await expect(collections.getByRole('button', { name: 'To review 1', exact: true })).toBeVisible();

  // 3. Natural Auto on unedited keepers (the same engine as unattended keeper Auto).
  await page.getByRole('button', { name: 'Workspace options' }).click();
  await page.locator('#workspace-options').getByRole('button', { name: /Auto-adjust unedited keepers/ }).click();
  await page.getByRole('alertdialog', { name: 'Auto-adjust unedited keepers?' }).getByRole('button', { name: 'Auto-adjust keepers' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Auto-adjusted \d+ keepers/ })).toBeVisible({ timeout: 60_000 });

  // 4. Open the dark keeper: Auto lifted it, and a manual adjustment goes on top.
  await collections.getByRole('button', { name: 'Keepers 2', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('[aria-label="Shoot filmstrip"]').getByRole('button', { name: 'Jump to frame j-1-dark.png' }).click();
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  const exposure = page.getByRole('slider', { name: 'Exposure adjustment' });
  const autoExposure = Number(await exposure.inputValue());
  expect(autoExposure, 'Natural Auto should lift the underexposed keeper').toBeGreaterThan(0);
  const contrast = page.getByRole('slider', { name: 'Contrast adjustment' });
  await contrast.focus();
  await contrast.press('ArrowRight');
  const manualContrast = await contrast.inputValue();
  expect(Number(manualContrast)).toBeGreaterThan(0);

  // 5. Full-size export at the source's true dimensions, with the edit applied.
  await openExportDialog(page);
  await page.getByRole('button', { name: 'Full size', exact: true }).click();
  await page.getByRole('checkbox', { name: /Full size · PNG/ }).check();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare 1 file', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '1 file ready' })).toBeVisible({ timeout: 60_000 });
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/j-1-dark/);
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(Buffer.from(chunk));
  const png = Buffer.concat(chunks);
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect([png.readUInt32BE(16), png.readUInt32BE(20)], 'export keeps the true source dimensions').toEqual([1500, 1000]);
  // The export is the shared edit maths applied to the original: replay the editor's exact recipe on the original's
  // centre and compare with the same pixels of the exported file.
  const crop = { x: 650, y: 400, w: 200, h: 200 };
  const pixels = await page.evaluate(async ({ exported, original, crop }) => {
    const read = async (b64: string) => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const c = canvas.getContext('2d')!;
      c.drawImage(bitmap, 0, 0);
      const d = c.getImageData(crop.x, crop.y, crop.w, crop.h).data;
      let binary = '';
      for (let i = 0; i < d.length; i += 0x8000) binary += String.fromCharCode(...d.subarray(i, i + 0x8000));
      return btoa(binary);
    };
    return { exported: await read(exported), original: await read(original) };
  }, { exported: png.toString('base64'), original: fixtures[0].data, crop });
  const recipe = await readRecipe(page);
  expect(recipe.exposure).toBe(autoExposure);
  const expected = Uint8ClampedArray.from(Buffer.from(pixels.original, 'base64'));
  applyPhotoEdit(expected, recipe);
  if (hasDetail(recipe)) applyDetail(expected, crop.w, crop.h, recipe, 1500);
  const actual = Uint8ClampedArray.from(Buffer.from(pixels.exported, 'base64'));
  let worst = 0, total = 0;
  for (let i = 0; i < actual.length; i += 4) for (let k = 0; k < 3; k += 1) {
    const d = Math.abs(actual[i + k] - expected[i + k]);
    worst = Math.max(worst, d); total += d;
  }
  const original = Uint8ClampedArray.from(Buffer.from(pixels.original, 'base64'));
  let changed = 0;
  for (let i = 0; i < actual.length; i += 1) if (i % 4 !== 3 && actual[i] !== original[i]) changed += 1;
  expect(changed, 'the edit is in the exported pixels').toBeGreaterThan(actual.length / 2);
  expect(total / (actual.length * 0.75), `export matches the shared edit maths (recipe ${JSON.stringify(recipe)})`).toBeLessThan(1);
  expect(worst).toBeLessThanOrEqual(3);
  await page.keyboard.press('Escape');

  // 6. Leave, reload, reopen: decisions, Auto and the manual edit survive.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Back to projects' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Journey 4 photos' }).click();
  await expect(collections.getByRole('button', { name: 'Keepers 2', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(collections.getByRole('button', { name: 'To review 1', exact: true })).toBeVisible();
  await expect(collections.getByRole('button', { name: 'Trash 1', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Re-select the original files' })).toHaveCount(0);
  await collections.getByRole('button', { name: 'Keepers 2', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('[aria-label="Shoot filmstrip"]').getByRole('button', { name: 'Jump to frame j-1-dark.png' }).click();
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  await expect(exposure).toHaveValue(String(autoExposure));
  await expect(contrast).toHaveValue(manualContrast);
});

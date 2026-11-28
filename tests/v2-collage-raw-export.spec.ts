import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { mosaic } from './rawFixture';

/**
 * Collage export choices (preview `kestrel.preview.collage-export.v1`, off by default): a collage holding a RAW photo
 * exports, the RAW developed by InFlight from its sensor data; the export size can be doubled, and every window's real
 * pixels are shown before export, so an enlarged window is never silent. An album PDF takes a chosen print resolution and
 * warns per window instead of stopping. Synthetic files only: a 96 × 64 DNG mosaic and flat PNGs.
 */
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Photographs are dragged onto collage windows, which needs a mouse.');
});

const PREVIEW = 'kestrel.preview.collage-export.v1';

async function collageWithRaw(page: Page) {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByText('Collage or album').click();
  await page.getByLabel(/name/i).first().fill('RAW collage');
  await page.getByRole('dialog').getByRole('button', { name: /create project/i }).last().click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2400; canvas.height = 1600;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#3d6b3d'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([
    { name: 'sensor.dng', mimeType: 'application/octet-stream', buffer: Buffer.from(mosaic) },
    { name: 'large.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') },
  ]);
  const tiles = root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option');
  await expect(tiles).toHaveCount(2);
  const raw = tiles.filter({ hasText: 'sensor.dng' });
  // The background develop has made the RAW's own picture from its sensor data.
  await expect(raw.getByTestId('picture-source')).toHaveAttribute('data-picture-source', 'raw-screen', { timeout: 30_000 });
  await raw.dragTo(root.getByTestId('collage-window-0'));
  await expect(root.getByTestId('collage-window-0')).toHaveAccessibleName(/sensor\.dng/);
  await tiles.filter({ hasText: 'large.png' }).dragTo(root.getByTestId('collage-window-1'));
  await expect(root.getByTestId('collage-window-1')).toHaveAccessibleName(/large\.png/);
  return root;
}

async function openExport(page: Page, root: Locator) {
  await root.getByRole('button', { name: /^Export/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Export collage' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Width and height from a JPEG's frame header. */
function jpegSize(bytes: Uint8Array): [number, number] {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    const marker = bytes[offset + 1];
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return [(bytes[offset + 7] << 8) | bytes[offset + 8], (bytes[offset + 5] << 8) | bytes[offset + 6]];
    offset += 2 + length;
  }
  throw new Error('No JPEG frame header.');
}

test('with the preview off the dialog is as before: no size choices, and RAW originals are said to be unsupported', async ({ page }) => {
  const root = await collageWithRaw(page);
  const dialog = await openExport(page, root);
  await expect(dialog.getByTestId('collage-output-choices')).toHaveCount(0);
  await expect(dialog.getByText(/RAW and HEIF originals are not yet supported/)).toBeVisible();
});

test('a collage with a RAW photo exports at twice the size, after saying which windows are enlarged', async ({ page }) => {
  await page.addInitScript((key) => { try { localStorage.setItem(key, '1'); } catch { /* storage blocked */ } }, PREVIEW);
  const root = await collageWithRaw(page);
  const dialog = await openExport(page, root);
  await expect(dialog.getByTestId('collage-output-choices')).toBeVisible();
  await expect(dialog.getByText(/RAW photos are developed by InFlight from their sensor data/)).toBeVisible();

  // Every filled window is listed with its real pixels. The 96 × 64 RAW cannot fill a window on a 1080 px page.
  const checks = dialog.getByTestId('collage-window-check');
  await expect(checks).toHaveCount(2);
  const rawCheck = checks.filter({ hasText: 'sensor.dng' });
  await expect(rawCheck).toHaveAttribute('data-low', 'true');
  await expect(rawCheck).toContainText(/px in the photo, shown at/);
  await expect(rawCheck).toContainText(/Enlarged to \d+%/);
  await expect(checks.filter({ hasText: 'large.png' })).not.toHaveAttribute('data-low', 'true');
  await expect(dialog.getByTestId('collage-soft-summary')).toContainText('1 window has fewer pixels');

  // A custom long edge shows the page size it gives; then choose twice the size.
  await dialog.getByTestId('collage-scale-custom').check();
  await dialog.getByTestId('collage-custom-edge').fill('1600');
  await expect(dialog.getByTestId('collage-custom-size')).toHaveText('1600 × 1600 px');
  await dialog.getByTestId('collage-scale-x2').check();
  // The PNG has not been opened, so its size is not known yet: it says so instead of guessing, and is checked on export.
  await expect(checks.filter({ hasText: 'large.png' })).toContainText("The photo's size is checked when the collage is exported.");

  const run = dialog.getByTestId('collage-export-run');
  await expect(run).toHaveText('Export anyway (1 softer window)');
  const downloaded = page.waitForEvent('download');
  await run.click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/\.jpg$/);
  const bytes = await readFile((await download.path())!);
  expect(jpegSize(bytes)).toEqual([2160, 2160]);
  // After export the decoded pixels were checked too: the tall window (1868 px) enlarges the 1600 px-high PNG a little,
  // so the notice counts both windows rather than only the one known beforehand.
  await expect(page.getByText(/Collage exported\. 2 windows were enlarged or below the print resolution/)).toBeVisible({ timeout: 15_000 });
});

test('an album PDF takes the chosen print resolution and warns per window instead of stopping', async ({ page }) => {
  await page.addInitScript((key) => { try { localStorage.setItem(key, '1'); } catch { /* storage blocked */ } }, PREVIEW);
  const root = await collageWithRaw(page);
  await root.getByTestId('collage-tool-size').click();
  await root.getByRole('combobox', { name: 'Page size' }).selectOption('a4-portrait');
  const dialog = await openExport(page, root);
  const dpi = dialog.getByTestId('collage-print-dpi');
  await expect(dpi).toHaveValue('300');
  await dpi.selectOption('240');
  await expect(dialog.getByText(/240 PPI, 3 mm bleed/)).toBeVisible();
  const checks = dialog.getByTestId('collage-window-check');
  await expect(checks.filter({ hasText: 'sensor.dng' })).toContainText(/pixels per inch, below the 240 DPI chosen/);
  const run = dialog.getByTestId('collage-export-run');
  await expect(run).toHaveText(/Export anyway \(\d+ softer windows?\)/);
  const downloaded = page.waitForEvent('download');
  await run.click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  const pdf = await readFile((await download.path())!);
  expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
});

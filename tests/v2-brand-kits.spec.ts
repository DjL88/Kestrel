import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';

// Brand kits (x-workflow-brand, K080), on by default: a saved logo, colours and text style that Export puts
// on every photo in one step. Kits are saved, renamed, restyled and deleted on this device; originals are never written.

/** A text watermark in this device's library, so a kit has a real logo to put on. */
const STUDIO_MARK = { id: 'wm-studio-test', label: 'Studio test mark', text: 'STUDIO TEST MARK', subtext: 'BRAND KIT' };

async function projectWithPhoto(page: Page, preview: boolean, withLogo = true) {
  if (preview) await page.addInitScript(() => localStorage.setItem('kestrel.preview.brand-kits.v1', '1'));
  if (withLogo) await page.addInitScript((mark) => localStorage.setItem('inflight.v2.watermarks', JSON.stringify([mark])), STUDIO_MARK);
  await page.goto('/?v2');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Brand kit');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  await studio.getByRole('button', { name: 'Import', exact: true }).first().waitFor();
  await studio.evaluate((target) => {
    const canvas = document.createElement('canvas');
    canvas.width = 480; canvas.height = 320;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#556677'; ctx.fillRect(0, 0, 480, 320);
    const bytes = Uint8Array.from(atob(canvas.toDataURL().split(',')[1]), (char) => char.charCodeAt(0));
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([bytes], 'kite.png', { type: 'image/png' }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
  });
  await expect(studio.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  const dialog = page.getByRole('dialog', { name: /export/i });
  // Brand kits sit behind Advanced in the Export dialog, which starts closed each time it opens.
  const open = async () => {
    if (!await dialog.isVisible()) await studio.getByRole('button', { name: /^Export/ }).first().click();
    const box = dialog.getByTestId('export-advanced'); await box.waitFor();
    const advanced = box.locator('button[aria-expanded="false"]'); if (await advanced.count()) await advanced.click();
  };
  const exportZip = async () => {
    const downloaded = page.waitForEvent('download');
    await dialog.getByRole('button', { name: /export bundle/i }).click();
    const files = Object.values(unzipSync(await readFile((await (await downloaded).path())!)));
    expect(files).toHaveLength(1);
    return Buffer.from(files[0]);
  };
  return { studio, dialog, open, exportZip };
}

/** How many pixels of two exported photos differ clearly, decoded in the browser. Byte comparison is not enough: the
 * file's metadata (such as the export time) can differ when the pixels are identical. */
async function changedPixels(page: Page, a: Buffer, b: Buffer): Promise<{ changed: number; total: number }> {
  return page.evaluate(async ([first, second]) => {
    const decode = async (base64: string) => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))]));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height);
    };
    const [x, y] = await Promise.all([decode(first), decode(second)]);
    if (x.width !== y.width || x.height !== y.height) return { changed: x.width * x.height, total: x.width * x.height };
    let changed = 0;
    for (let i = 0; i < x.data.length; i += 4) {
      if (Math.max(Math.abs(x.data[i] - y.data[i]), Math.abs(x.data[i + 1] - y.data[i + 1]), Math.abs(x.data[i + 2] - y.data[i + 2])) > 32) changed += 1;
    }
    return { changed, total: x.width * x.height };
  }, [a.toString('base64'), b.toString('base64')] as const);
}

test('on by default: without the device switch, Export still offers brand kits', async ({ page }) => {
  const { dialog, open } = await projectWithPhoto(page, false);
  await open();
  await expect(dialog.getByRole('heading', { name: /export/i }).first()).toBeVisible();
  await expect(dialog.getByTestId('export-brand-kits')).toBeVisible();
});

test('a brand kit is saved, put on in one export step, edited, kept after reload and removed', async ({ page }) => {
  const { dialog, open, exportZip } = await projectWithPhoto(page, true);
  await open();
  const kits = dialog.getByTestId('export-brand-kits');
  await expect(kits).toBeVisible();
  const plain = await exportZip();

  // Save the photo's look (the device's watermark, light text) as a kit.
  await open();
  await kits.getByRole('textbox', { name: 'Brand kit name' }).fill('  Studio   kit ');
  await kits.getByRole('button', { name: "Save this photo's look as a kit" }).click();
  const choose = kits.getByRole('combobox', { name: 'Brand kit to put on' });
  await expect(choose.locator('option')).toHaveText(['No brand kit', 'Studio kit']);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('inflight-v2-brand-kits') ?? '[]'));
  expect(stored).toHaveLength(1);
  expect(stored[0].name).toBe('Studio kit');

  // One step: choose the kit and export. The logo is now on the exported photo.
  await choose.selectOption({ label: 'Studio kit' });
  await expect(kits.getByTestId('brand-kit-summary')).toContainText(`Logo: ${STUDIO_MARK.label}.`);
  expect(stored[0].watermarkPresetId).toBe(STUDIO_MARK.id);
  const branded = await exportZip();
  const { changed, total } = await changedPixels(page, plain, branded);
  expect(changed).toBeGreaterThan(total * 0.001);

  // Edit: rename and take the photo's look again; the name is kept after a reload.
  await open();
  await choose.selectOption({ label: 'Studio kit' });
  await kits.getByRole('textbox', { name: 'Brand kit name' }).fill('Wedding');
  await kits.getByRole('button', { name: 'Rename' }).click();
  await expect(choose.locator('option')).toHaveText(['No brand kit', 'Wedding']);
  await kits.getByRole('button', { name: "Use this photo's look" }).click();
  await page.reload();
  await page.locator('.inflight-v2').getByRole('button', { name: 'Brand kit', exact: true }).first().click();
  await expect(page.locator('.inflight-v2').getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  await open();
  await expect(choose.locator('option')).toHaveText(['No brand kit', 'Wedding']);

  // Remove: the kit goes, and the section offers to save a new one.
  await choose.selectOption({ label: 'Wedding' });
  await kits.getByRole('button', { name: 'Delete Wedding' }).click();
  await expect(choose).toHaveCount(0);
  await expect(kits.getByRole('button', { name: "Save this photo's look as a kit" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('inflight-v2-brand-kits'))).toBe('[]');
});

test('a kit on a device with no saved watermark says Export puts no logo, and the pixels stay as they were', async ({ page }) => {
  const { dialog, open, exportZip } = await projectWithPhoto(page, true, false);
  await open();
  const kits = dialog.getByTestId('export-brand-kits');
  const plain = await exportZip();
  await open();
  await kits.getByRole('textbox', { name: 'Brand kit name' }).fill('No logo');
  await kits.getByRole('button', { name: "Save this photo's look as a kit" }).click();
  await kits.getByRole('combobox', { name: 'Brand kit to put on' }).selectOption({ label: 'No logo' });
  await expect(kits.getByTestId('brand-kit-summary')).toContainText('Logo: none. No watermark is saved on this device');
  const branded = await exportZip();
  expect((await changedPixels(page, plain, branded)).changed).toBe(0);
});

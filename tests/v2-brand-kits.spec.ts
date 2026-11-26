import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';

// Brand kits (x-workflow-brand, K080), on by default: a saved logo, colours and text style that Export puts
// on every photo in one step. Kits are saved, renamed, restyled and deleted on this device; originals are never written.

async function projectWithPhoto(page: Page, preview: boolean) {
  if (preview) await page.addInitScript(() => localStorage.setItem('kestrel.preview.brand-kits.v1', '1'));
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
  const open = async () => { if (!await dialog.isVisible()) await studio.getByRole('button', { name: /^Export/ }).first().click(); };
  const exportZip = async () => {
    const downloaded = page.waitForEvent('download');
    await dialog.getByRole('button', { name: /export bundle/i }).click();
    const files = Object.values(unzipSync(await readFile((await (await downloaded).path())!)));
    expect(files).toHaveLength(1);
    return Buffer.from(files[0]);
  };
  return { studio, dialog, open, exportZip };
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

  // Save the photo's look (the default logo, light text) as a kit.
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
  await expect(kits.getByTestId('brand-kit-summary')).toContainText('Logo:');
  const branded = await exportZip();
  expect(branded.equals(plain)).toBe(false);

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

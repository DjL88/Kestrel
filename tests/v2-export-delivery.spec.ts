import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';

test('a real project exports full-resolution and capped PNGs and the exact original', async ({ page }) => {
  await page.goto('/?v2');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('PNG delivery');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 360;
    canvas.height = 140;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#445566';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL().split(',')[1];
  });
  const original = Buffer.from(base64, 'base64');
  await studio.getByRole('button', { name: 'Import', exact: true }).first().waitFor();
  await studio.evaluate((target, encoded) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([Uint8Array.from(atob(encoded), char => char.charCodeAt(0))], 'bird.png', { type: 'image/png' }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
  }, base64);
  await expect(studio.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  const dialog = page.getByRole('dialog', { name: /export/i });
  const open = async () => {
    if (!await dialog.isVisible()) await studio.getByRole('button', { name: /^Export/ }).first().click();
  };
  const downloadZip = async () => {
    const downloaded = page.waitForEvent('download');
    await dialog.getByRole('button', { name: /export bundle/i }).click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toMatch(/\.zip$/);
    return unzipSync(await readFile((await download.path())!));
  };
  await open();
  await dialog.getByLabel('File format').selectOption('png');
  await expect(dialog.getByRole('slider', { name: 'JPEG quality' })).toHaveCount(0);
  const verifyPngSize = async (width: number, height: number) => {
    const developed = Object.entries(await downloadZip());
    expect(developed).toHaveLength(1);
    const [[name, bytes]] = developed;
    expect(name).toMatch(/\.png$/);
    expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const png = Buffer.from(bytes);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([width, height]);
  };
  await verifyPngSize(360, 140);

  await open();
  await dialog.getByLabel('File format').selectOption('png');
  await dialog.getByRole('combobox', { name: 'Size', exact: true }).selectOption('custom');
  await dialog.getByRole('spinbutton', { name: 'Custom long edge (px)' }).fill('180');
  await verifyPngSize(180, 70);

  await open();
  await dialog.getByRole('button', { name: /Original file: exact copy/ }).click();
  await dialog.getByRole('button', { name: /After \(edited\)/ }).click();
  const chosen = dialog.locator('.grid.grid-cols-2 button[aria-pressed="true"]');
  while (await chosen.count()) await chosen.first().click();
  const originals = await downloadZip();
  expect(Object.keys(originals)).toEqual(['bird.png']);
  expect(Buffer.from(originals['bird.png'])).toEqual(original);
});

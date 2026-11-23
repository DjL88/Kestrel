import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';

test('a real project can download developed PNGs and its exact original without choosing a size', async ({ page }) => {
  await page.goto('/?v2');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('PNG delivery');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 80;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#445566';
    ctx.fillRect(0, 0, 120, 80);
    return canvas.toDataURL().split(',')[1];
  });
  const original = Buffer.from(base64, 'base64');
  const picker = page.waitForEvent('filechooser');
  await studio.getByRole('button', { name: 'Import', exact: true }).first().click();
  await (await picker).setFiles([{ name: 'bird.png', mimeType: 'image/png', buffer: original }]);
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
  const developed = Object.entries(await downloadZip());
  expect(developed).toHaveLength(3);
  for (const [name, bytes] of developed) {
    expect(name).toMatch(/\.png$/);
    expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  }
  await open();
  await dialog.getByRole('button', { name: /Original file: exact copy/ }).click();
  await dialog.getByRole('button', { name: /After \(edited\)/ }).click();
  const chosen = dialog.locator('.grid.grid-cols-2 button[aria-pressed="true"]');
  while (await chosen.count()) await chosen.first().click();
  const originals = await downloadZip();
  expect(Object.keys(originals)).toEqual(['bird.png']);
  expect(Buffer.from(originals['bird.png'])).toEqual(original);
});
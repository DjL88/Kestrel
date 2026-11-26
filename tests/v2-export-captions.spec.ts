import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';

test('captions and credits, with a code replacement, are written into the exported file', async ({ page }) => {
  await page.goto('/?v2');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Captions');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 120; canvas.height = 80;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#556677'; ctx.fillRect(0, 0, 120, 80);
    return canvas.toDataURL().split(',')[1];
  });
  await studio.getByRole('button', { name: 'Import', exact: true }).first().waitFor();
  await studio.evaluate((target, encoded) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([Uint8Array.from(atob(encoded), char => char.charCodeAt(0))], 'typhoon.png', { type: 'image/png' }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
  }, base64);
  await expect(studio.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  await studio.getByRole('button', { name: /^Export/ }).first().click();
  const dialog = page.getByRole('dialog', { name: /export/i });
  const captions = dialog.getByTestId('export-captions');
  await captions.getByText('Captions and credits', { exact: true }).click();
  await captions.getByLabel('Add captions and credits to each file').check();
  await captions.getByLabel('Caption', { exact: true }).fill('\\raf\\ display, {filename}');
  await captions.getByLabel('Photographer').fill('Test Photographer');
  await captions.getByLabel('Country').fill('United Kingdom');
  await captions.getByLabel(/Code replacements/).fill('raf = Royal Air Force');
  await dialog.getByLabel('File format').selectOption('png');
  const downloaded = page.waitForEvent('download');
  await dialog.getByRole('button', { name: /export bundle/i }).click();
  const files = Object.entries(unzipSync(await readFile((await (await downloaded).path())!)));
  expect(files).toHaveLength(1);
  const text = Buffer.from(files[0][1]).toString('utf8');
  expect(text).toContain('XML:com.adobe.xmp');
  expect(text).toContain('Royal Air Force display, typhoon');
  expect(text).toContain('<rdf:li>Test Photographer</rdf:li>');
  expect(text).toContain('<photoshop:Country>United Kingdom</photoshop:Country>');
});

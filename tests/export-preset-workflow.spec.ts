import { expect, test } from '@playwright/test';
import { openExportDialog } from './helpers';

test('a saved custom delivery preset restores artwork, naming and output dimensions', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kestrel.exportView', 'list');
    localStorage.setItem('kestrel.exportPresets.v1', JSON.stringify([{
      name: 'Wildlife web', formats: [], fits: {}, turned: {}, overrides: {}, bars: 'white',
      custom: { width: 120, height: 80, fit: 'keep', format: 'png', quality: 100, prefix: 'web_' },
      naming: { name: 'Wildlife', numbers: 'sequence' },
      overlay: { on: true, title: 'Bird walk', camera: false, lens: false, settings: false,
        date: false, place: 'bottom', tone: 'light',
        watermark: { on: true, kind: 'text', text: 'Dave', font: 'atkinson',
          position: 'top-left', size: 0.1, opacity: 1, tone: 'light' },
      },
    }]));
  });
  await page.goto('/');
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 400;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#234'; context.fillRect(0, 0, 600, 400);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByTestId('quick-edit-input').setInputFiles({ name: 'bird.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await openExportDialog(page);
  await page.getByRole('dialog', { name: 'Export photo' }).getByRole('tab', { name: 'Advanced' }).click();
  await page.getByText('Export presets', { exact: true }).click();
  await page.getByRole('button', { name: 'Wildlife web', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Bird walk');
  await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toHaveValue('Dave');
  await page.getByRole('dialog', { name: 'Export photo' }).getByRole('tab', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Width (px)' })).toHaveValue('120');
  await expect(page.getByRole('spinbutton', { name: 'Height (px)' })).toHaveValue('80');
  await page.getByRole('dialog', { name: 'Export photo' }).getByRole('tab', { name: 'Advanced' }).click();
  await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Saved again');
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('kestrel.exportPresets.v1')!).find((p: { name: string }) => p.name === 'Saved again'));
  expect(saved.custom.width).toBe(120);
  expect(saved.overlay.watermark.text).toBe('Dave');
  expect(saved.naming.name).toBe('Wildlife');
  expect(saved.anchors).toBeUndefined();
  await page.getByRole('button', { name: 'Prepare 1 file', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '1 file ready' })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toContain('Wildlife');
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(Buffer.from(chunk));
  const output = Buffer.concat(chunks);
  expect([output.readUInt32BE(16), output.readUInt32BE(20)]).toEqual([120, 80]);
  await expect(page.getByRole('dialog', { name: 'Export photo', exact: true })).toHaveCount(0);
});

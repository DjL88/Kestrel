import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';

test('20 imported photographs can be selected, edited and downloaded as a complete ZIP', async ({ page }) => {
  test.skip(test.info().project.name === 'phone', 'desktop grid and editor acceptance; touch selection is covered separately');
  test.setTimeout(180_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('20 real exports acceptance');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();

  const images = await page.evaluate(() => Array.from({ length: 20 }, (_, i) => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 220;
    const context = canvas.getContext('2d')!;
    context.fillStyle = `hsl(${i * 17} 65% 42%)`;
    context.fillRect(0, 0, 320, 220);
    context.fillStyle = '#ddd';
    context.fillRect(15 + i * 3, 20, 70, 110);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  await page.getByTestId('local-file-input').setInputFiles(images.map((image, index) => ({
    name: `keeper-${String(index + 1).padStart(2, '0')}.png`,
    mimeType: 'image/png',
    buffer: Buffer.from(image, 'base64'),
  })));
  const collections = page.getByRole('navigation', { name: 'Photo collections' });
  await expect(collections.getByRole('button', { name: 'All photos 20' })).toBeVisible();

  await page.getByRole('button', { name: 'Workspace options' }).click();
  await page.getByRole('button', { name: 'Select photos', exact: true }).click();
  await page.getByRole('button', { name: 'Select keeper-01.png' }).click();
  const sheet = page.getByTestId('virtualized-contact-sheet');
  await sheet.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const last = page.getByRole('button', { name: 'Select keeper-20.png' });
  await expect(last).toBeVisible();
  await last.click({ modifiers: ['Shift'] });
  await expect(page.getByText('20 selected', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Edit selected' }).click();
  const action = page.getByRole('button', { name: 'Export 20', exact: true });
  await expect(action).toBeVisible();
  await action.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Export 20 photos' })).toBeVisible();

  // Run the real export pipeline and archive builder, not a mocked file writer.
  await dialog.getByRole('button', { name: 'Instagram' }).click();
  await dialog.getByRole('checkbox', { name: /Post · 4:5/ }).check();
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await dialog.getByRole('button', { name: 'Prepare 20 files' }).click();
  await expect(dialog.getByRole('status').filter({ hasText: '20 files ready' })).toBeVisible({ timeout: 90_000 });

  const zipButton = dialog.getByRole('button', { name: 'Download ZIP' });
  await expect(zipButton).toBeEnabled({ timeout: 30000 });
  const download = page.waitForEvent('download');
  await zipButton.click();
  const output = await download;
  await expect(dialog).toBeHidden();
  expect(output.suggestedFilename()).toBe('kestrel-exports.zip');
  const zipPath = await output.path();
  expect(zipPath).not.toBeNull();
  const archive = unzipSync(new Uint8Array(await readFile(zipPath!)));
  const entries = Object.entries(archive);
  expect(entries).toHaveLength(20);
  expect(new Set(entries.map(([filename]) => filename)).size).toBe(20);
  for (const [filename, bytes] of entries) {
    expect(filename).toMatch(/\.jpg$/i);
    expect(bytes.byteLength, filename).toBeGreaterThan(1000);
    expect(bytes[0], filename).toBe(0xff);
    expect(bytes[1], filename).toBe(0xd8);
    expect(bytes[bytes.length - 2], filename).toBe(0xff);
    expect(bytes[bytes.length - 1], filename).toBe(0xd9);
  }
});

import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('reopening a project restores the original for byte-identical offline export', async ({ page, context }) => {
  await page.goto('/?v2');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Reopen originals');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 96;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#886655';
    ctx.fillRect(0, 0, 160, 96);
    return canvas.toDataURL().split(',')[1];
  });
  const bytes = Buffer.from(encoded, 'base64');
  const picking = page.waitForEvent('filechooser');
  await studio.getByRole('button', { name: 'Import', exact: true }).first().click();
  await (await picking).setFiles([{ name: 'bird.png', mimeType: 'image/png', buffer: bytes }]);
  await expect(studio.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  await studio.getByRole('button', { name: 'Back to projects' }).first().click();
  await expect(studio.getByRole('button', { name: 'Reopen originals', exact: true }).first()).toBeVisible();
  await page.reload();
  await studio.getByRole('button', { name: 'Reopen originals', exact: true }).first().click();
  await expect(studio.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  await context.setOffline(true);
  await studio.getByRole('button', { name: /^Export/ }).first().click();
  const dialog = page.getByRole('dialog', { name: /export/i });
  await dialog.getByRole('button', { name: /Download individual files/ }).click();
  await dialog.getByRole('button', { name: /Original file: exact copy/ }).click();
  await dialog.getByRole('button', { name: /After \(edited\)/ }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    dialog.getByRole('button', { name: /export bundle/i }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('bird.png');
  expect(await readFile((await download.path())!)).toEqual(bytes);
});

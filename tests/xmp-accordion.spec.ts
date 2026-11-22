import { expect, test } from '@playwright/test';

test('Save and Load XMP sit behind a quiet XMP disclosure in Photo info', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'XMP save and import are hidden on phones (owner decision).');
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('XMP accordion');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#777'; ctx.fillRect(0, 0, 128, 128);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles({ name: 'x.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') });
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  const save = page.getByRole('button', { name: 'Save XMP sidecar' });
  await expect(save).toBeHidden();
  await page.getByText('XMP', { exact: true }).click();
  await expect(save).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load XMP sidecar' })).toBeVisible();
});

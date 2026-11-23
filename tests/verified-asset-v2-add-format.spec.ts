import { expect, test } from '@playwright/test';

test('V2 Add format creates a separate local format and preserves Original on reopen', async ({ page }) => {
  await page.goto('/?v2');
  const workspace = page.locator('.inflight-v2');
  await workspace.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Format persistence');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();

  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 450;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#456789';
    context.fillRect(0, 0, 600, 450);
    return canvas.toDataURL().split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await workspace.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles({ name: 'format-source.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });

  const addFormat = workspace.getByRole('toolbar', { name: 'Selected format actions' }).getByRole('button', { name: 'Add format' });
  const originalWidth = workspace.getByLabel('Original output width');
  const originalHeight = workspace.getByLabel('Original output height');
  const customLabel = workspace.getByPlaceholder('Format label (e.g. A3 Print)');
  const customToggle = workspace.getByRole('button', { name: 'Include Portrait print' });

  await addFormat.click();
  await expect(customLabel).toBeFocused();
  await expect(originalWidth).toHaveCount(0);
  await customLabel.fill('Portrait print');
  const form = customLabel.locator('xpath=ancestor::form');
  await form.getByLabel('Width in px', { exact: true }).fill('300');
  await form.getByLabel('Height in px', { exact: true }).fill('400');
  await form.getByRole('button', { name: 'Add format' }).click();
  await expect(customToggle).toBeVisible();
  await expect(originalWidth).toHaveValue('600');
  await expect(originalHeight).toHaveValue('450');

  await workspace.getByRole('button', { name: /back|projects/i }).first().click();
  await expect(workspace.getByText('1 photo', { exact: true })).toBeVisible();
  await page.reload();
  await workspace.getByRole('button', { name: /Open studio/ }).first().click();
  await addFormat.click();
  await customLabel.locator('xpath=ancestor::form').getByRole('button', { name: 'Cancel' }).click();
  await expect(customToggle).toBeVisible();
  await expect(originalWidth).toHaveValue('600');
  await expect(originalHeight).toHaveValue('450');
});

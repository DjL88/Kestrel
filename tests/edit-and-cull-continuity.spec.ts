import { expect, test } from '@playwright/test';

test('Edit offers Undo and Redo, leaves decisions alone, and keeps the Review queue', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Cull while editing');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();

  const images = await page.evaluate(() => [0, 1, 2].map((index) => {
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 240;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = ['#6789ab', '#ad9746', '#548c64'][index];
    ctx.fillRect(0, 0, 320, 240);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles(images.map((data, index) => ({
    name: `editable-${index + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64'),
  })));
  const collections = page.getByRole('navigation', { name: 'Photo collections' });
  await expect(collections.getByRole('button', { name: 'To review 3' })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  const editor = page.getByRole('region', { name: 'Photo editor' });
  const footer = page.getByRole('toolbar', { name: 'Photo navigation and editing actions' });
  await expect(editor).toBeVisible();
  // The editor's bar offers Undo and Redo, not Keep and Reject (decisions live in Library, Compare and Photo info).
  await expect(footer.getByRole('button', { name: 'Step back' })).toBeDisabled();
  await expect(footer.getByRole('button', { name: 'Step forward' })).toBeDisabled();
  await expect(footer.getByRole('button', { name: 'Keep editable-1.png' })).toHaveCount(0);
  await expect(footer.getByRole('button', { name: 'Reject editable-1.png' })).toHaveCount(0);
  await footer.getByRole('button', { name: 'Next photo' }).click();
  await expect(editor).toBeVisible();
  await footer.getByRole('button', { name: 'Previous photo' }).click();
  await expect(editor).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await collections.getByRole('button', { name: /^All photos/ }).click();
  for (const name of ['editable-1.png', 'editable-2.png', 'editable-3.png']) {
    await expect(page.getByRole('article', { name: `Frame ${name}` }).getByTestId('tile-decision')).toHaveText('Undecided');
  }
});

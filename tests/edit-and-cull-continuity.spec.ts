import { expect, test } from '@playwright/test';

test('a photographer can Keep and Reject in Edit without losing the Review queue', async ({ page }) => {
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
  await footer.getByRole('button', { name: 'Keep editable-1.png' }).click();
  await expect(editor).toBeVisible();
  await footer.getByRole('button', { name: 'Next photo' }).click();
  await expect(footer.getByRole('button', { name: 'Reject editable-2.png' })).toBeVisible();
  await footer.getByRole('button', { name: 'Reject editable-2.png' }).click();
  await expect(editor).toBeVisible();

  // The session is deliberately stable even though the Review filter now
  // contains only the third image. No outside app or view switch is required.
  await footer.getByRole('button', { name: 'Previous photo' }).click();
  await expect(footer.getByRole('button', { name: 'Move editable-1.png back to review (Undecided)' })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await collections.getByRole('button', { name: /^All photos/ }).click();
  await expect(page.getByRole('article', { name: 'Frame editable-1.png' }).getByTestId('tile-decision')).toHaveText('Kept');
  await expect(page.getByRole('article', { name: 'Frame editable-2.png' }).getByTestId('tile-decision')).toHaveText('Rejected');
  await expect(page.getByRole('article', { name: 'Frame editable-3.png' }).getByTestId('tile-decision')).toHaveText('Undecided');
});

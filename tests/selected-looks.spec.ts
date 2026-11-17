import { expect, test } from '@playwright/test';

test('select two photos, apply monochrome recipe, keep third photo unchanged', async ({ page }) => {
  test.skip(test.info().project.name === 'phone', 'desktop grid/filmstrip flow; phone selection needs a dedicated test');
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Selected looks');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  const images = await page.evaluate(() => Array.from({ length: 3 }, (_, i) => {
    const canvas = document.createElement('canvas');
    canvas.width = 240; canvas.height = 160;
    const c = canvas.getContext('2d')!;
    c.fillStyle = ['#5876a1', '#a65d38', '#38856c'][i]; c.fillRect(0, 0, 240, 160);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  await page.getByTestId('local-file-input').setInputFiles(images.map((image, i) => ({
    name: `style-${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(image, 'base64'),
  })));
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 3' })).toBeVisible();
  await page.getByRole('button', { name: 'Workspace options' }).click();
  await page.getByRole('button', { name: 'Select photos' }).click();
  await page.getByRole('button', { name: 'Select style-1.png' }).click();
  await page.getByRole('button', { name: 'Select style-2.png' }).click();
  await page.getByRole('button', { name: 'Apply look', exact: true }).click();
  await expect(page.getByRole('alertdialog', { name: 'Apply recipe to selected photos' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Recipe for selected photos' }).selectOption('mono-natural');
  await expect(page.getByText('2 of 2 selected photos will change.')).toBeVisible();
  await page.getByRole('button', { name: 'Apply to 2 photos' }).click();
  await page.getByRole('button', { name: 'Edit selected' }).click();
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Colour adjustment' })).toHaveValue('-2');
  await page.getByRole('toolbar', { name: 'Filmstrip controls' }).getByRole('button', { name: 'Hide filmstrip' }).click();
  await page.getByRole('button', { name: 'Next photo' }).click();
  await expect(page.getByRole('slider', { name: 'Colour adjustment' })).toHaveValue('-2');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Workspace options' }).click();
  await page.getByRole('button', { name: 'Select photos' }).click();
  await page.getByRole('button', { name: 'Select style-3.png' }).click();
  await page.getByRole('button', { name: 'Edit selected' }).click();
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Colour adjustment' })).toHaveValue('0');
});

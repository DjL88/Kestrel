import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('Library applies a saved look to keepers and Edit shows matching sliders', async ({ page }) => {
  const photo = readFileSync('src/assets/images/demo_red_kite_flight_1794721996053.jpg');
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Batch look acceptance');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles({ name: 'kite.jpg', mimeType: 'image/jpeg', buffer: photo });
  const library = page.getByRole('navigation', { name: 'Photo collections' });
  await expect(library.getByRole('button', { name: 'To review 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep kite.jpg' }).click();
  await library.getByRole('button', { name: 'Keepers 1' }).click();
  await page.getByRole('button', { name: 'Workspace options' }).click();
  await page.getByRole('button', { name: 'Apply look to keepers…' }).click();
  await expect(page.getByRole('alertdialog', { name: 'Apply a look to keepers' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Look for keepers' }).selectOption('mono-natural');
  await expect(page.getByText('1 of 1 keepers will receive this look.')).toBeVisible();
  await page.getByRole('button', { name: 'Apply to 1 photo' }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Colour adjustment' })).toHaveValue('-2');
});

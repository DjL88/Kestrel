import { expect, test } from '@playwright/test';

test('Soar, Glide and Fly Solo live in Settings and persist as a preference', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  const soar = dialog.getByRole('radio', { name: /Soar/ });
  const glide = dialog.getByRole('radio', { name: /Glide/ });
  const solo = dialog.getByRole('radio', { name: /Fly Solo/ });
  await expect(glide).toBeChecked();
  await soar.check();
  await expect(soar).toBeChecked();
  await solo.check();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await expect(page.getByRole('dialog').getByRole('radio', { name: /Fly Solo/ })).toBeChecked();
});

test('Fly Solo never runs the normal colour check until the photographer asks', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await page.getByRole('dialog').getByRole('radio', { name: /Fly Solo/ }).check();
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Flight guidance');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  const bytes = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#9a9a9a';
    context.fillRect(0, 0, 100, 100);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles({
    name: 'flight-guidance.png', mimeType: 'image/png', buffer: Buffer.from(bytes, 'base64'),
  });
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  const all = page.getByRole('button', { name: 'All controls' });
  if (await all.isVisible()) await all.click();

  await expect(page.getByTestId('colour-check')).toHaveCount(0);
  await page.getByRole('button', { name: 'Check colour' }).click();
  await expect(page.getByTestId('colour-check')).toBeVisible();
});

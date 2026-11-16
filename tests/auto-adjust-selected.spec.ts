import { expect, test } from '@playwright/test';

test('two selected photos receive independent Auto adjustments, third remains unedited', async ({ page }) => {
  test.skip(test.info().project.name === 'phone', 'desktop filmstrip flow; phone uses a separate folded editor sheet');
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Batch Auto Selection');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  const pngs = await page.evaluate(() => Array.from({ length: 3 }, (_, i) => {
    const canvas = document.createElement('canvas');
    canvas.width = 300; canvas.height = 200;
    const c = canvas.getContext('2d')!;
    c.fillStyle = ['#1b1c20', '#282a34', '#a0b0ba'][i];
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.fillStyle = ['#414553', '#555870', '#c0ced2'][i];
    c.fillRect(80, 55, 100, 90);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  await page.getByTestId('local-file-input').setInputFiles(pngs.map((data, i) =>
    ({ name: `photo-${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') })));
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 3' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const bar = page.getByRole('toolbar', { name: 'Filmstrip controls' });
  await bar.getByRole('button', { name: 'Select photos' }).click();
  const film = page.locator('[aria-label="Shoot filmstrip"]');
  await film.getByRole('button', { name: 'Select photo-2.png' }).click();
  await expect(bar.getByRole('button', { name: 'Auto-adjust', exact: true })).toBeVisible();
  await bar.getByRole('button', { name: 'Auto-adjust', exact: true }).click();
  const confirmation = page.getByRole('alertdialog', { name: 'Auto-adjust selected photos?' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Analyse selected photos' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Auto-adjusted selected photos' })).toBeVisible({ timeout: 30000 });
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  const light = page.getByRole('slider', { name: 'Light adjustment' });
  expect(Number(await light.inputValue())).toBeGreaterThan(0);
  await film.getByRole('button', { name: 'Select photo-2.png' }).click();
  expect(Number(await light.inputValue())).toBeGreaterThan(0);
  await bar.getByRole('button', { name: 'Done selecting' }).click();
  await film.getByRole('button', { name: 'Jump to frame photo-3.png' }).click();
  await expect(light).toHaveValue('0');
});

import { expect, test } from '@playwright/test';

/** Regression: choosing Mono with two filmstrip photos selected must edit both,
 * even when the separate 'Edit together' slider toggle has not been activated. */
test('Auto Mono look applies to both selected photographs, but not the third', async ({ page }) => {
  test.skip(test.info().project.name === 'phone', 'desktop filmstrip flow; phone uses a separate folded editor sheet');
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Two photos Mono regression');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();

  const pngs = await page.evaluate(() => Array.from({ length: 3 }, (_, i) => {
    const canvas = document.createElement('canvas');
    canvas.width = 240; canvas.height = 160;
    const context = canvas.getContext('2d')!;
    context.fillStyle = ['#ac5c3c', '#3584a5', '#7b9c43'][i];
    context.fillRect(0, 0, 240, 160);
    context.fillStyle = '#ffffff';
    context.fillRect(30 + i * 10, 30, 70, 90);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  await page.getByTestId('local-file-input').setInputFiles(pngs.map((data, i) => ({
    name: `photo-${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64'),
  })));
  await expect(page.getByRole('navigation', { name: 'Photo collections' })
    .getByRole('button', { name: 'To review 3' })).toBeVisible();

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const bar = page.getByRole('toolbar', { name: 'Filmstrip controls' });
  await bar.getByRole('button', { name: 'Select photos' }).click();
  const filmstrip = page.locator('[aria-label="Shoot filmstrip"]');
  await filmstrip.getByRole('button', { name: 'Select photo-2.png' }).click();

  const actions = page.getByRole('toolbar', { name: 'Filmstrip controls' });
  await expect(actions.getByText('2 selected')).toBeVisible();
  await expect(actions.getByRole('button', { name: 'Edit together' })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('tab', { name: 'Auto' }).click();
  const looks = page.getByRole('group', { name: 'Photo recipes gallery' });
  await looks.getByRole('button', { name: 'Mono natural' }).click();

  // Both selected images receive the real monochrome edit, not just a thumbnail effect.
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  const slider = page.getByRole('slider', { name: 'Colour adjustment' });
  await expect(slider).toHaveValue('-2');
  await filmstrip.getByRole('button', { name: 'Select photo-1.png' }).click();
  await expect(slider).toHaveValue('-2');
  await filmstrip.getByRole('button', { name: 'Select photo-2.png' }).click();
  await expect(slider).toHaveValue('-2');

  // An unselected photo remains colour when opened alone.
  await bar.getByRole('button', { name: 'Done selecting' }).click();
  await filmstrip.getByRole('button', { name: 'Jump to frame photo-3.png' }).click();
  await expect(slider).toHaveValue('0');
});

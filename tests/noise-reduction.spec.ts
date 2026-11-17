import { expect, test } from '@playwright/test';

test('Noise reduction is a Detail slider that only goes up, counts as an edit, and undoes', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Noise reduction');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  const png = await page.evaluate(() => {
    // A flat photo with coloured speckle, the way high-ISO shadows look.
    const canvas = document.createElement('canvas');
    canvas.width = 120; canvas.height = 80;
    const ctx = canvas.getContext('2d')!;
    const image = ctx.createImageData(120, 80);
    for (let i = 0; i < 120 * 80; i += 1) {
      const jitter = (((i * 7919) % 11) - 5) * 8;
      image.data.set([70 + jitter, 70, 70 - jitter, 255], i * 4);
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByTestId('local-file-input').setInputFiles({ name: 'speckle.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  // On a phone the full list is one tap behind the quick adjust strip.
  const allControls = page.getByRole('button', { name: 'All controls' });
  if (await allControls.isVisible()) await allControls.click();

  const slider = page.getByRole('slider', { name: 'Noise reduction adjustment' });
  await expect(slider).toHaveAttribute('min', '0');
  await expect(slider).toHaveAttribute('max', '2');
  await expect(slider).toHaveValue('0');
  const undo = page.getByRole('toolbar', { name: 'Editor actions' }).getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeDisabled();

  await slider.focus();
  await slider.press('ArrowRight');
  await expect(slider).toHaveValue('0.05');
  await expect(undo).toBeEnabled(); // On its own it is a real edit, not a neutral one.
  await slider.press('End');
  await expect(slider).toHaveValue('2');
  await undo.click();
  await expect(slider).not.toHaveValue('2');
});

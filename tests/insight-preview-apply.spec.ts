import { expect, test } from '@playwright/test';

// The offline worker caches the model after the first request, and a cached answer bypasses page.route, so the
// "model unavailable" set-up below would only hold for the first attempt. Keep the worker out of this test.
test.use({ serviceWorkers: 'block' });

test('Insight explains a failed local detector and never changes an edit before Apply', async ({ page }) => {
  test.setTimeout(90_000);
  // Make the bundled model unavailable to exercise the truthful offline fallback.
  // The global suggestion and preview controls must continue to work.
  await page.route(/u2netp.*\.onnx/i, (route) => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Insight preview regression');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 300; canvas.height = 200;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#23252c'; ctx.fillRect(0, 0, 300, 200);
    ctx.fillStyle = '#656971'; ctx.fillRect(90, 55, 95, 90);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByTestId('local-file-input').setInputFiles({
    name: 'dark-subject.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64'),
  });
  await expect(page.getByRole('navigation', { name: 'Photo collections' })
    .getByRole('button', { name: 'To review 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  // Undo is in the editor's toolbar, or on a phone in Quick adjust (Step back) while that is showing.
  const undo = page.getByRole('button', { name: /^(Undo|Step back)$/ });
  await expect(undo).toBeDisabled();

  const panel = page.getByRole('tabpanel', { name: 'Auto' });
  await page.getByRole('tab', { name: 'Auto' }).click();
  // On a phone, tapping the tab that is already open folds the sheet away; open it again if so.
  if (!(await panel.isVisible())) await page.getByRole('tab', { name: 'Auto' }).click();
  const suggest = panel.getByRole('button', { name: 'Suggest a look' });
  await expect(suggest).toBeEnabled();
  await suggest.click();
  await expect(panel.getByRole('group', { name: 'Suggested edit preview' })).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByText('Subject detection was unavailable.', { exact: false })).toBeVisible();
  await expect(undo).toBeDisabled(); // Preview does not write an edit or history.
  const compare = panel.getByRole('button', { name: 'Compare before / after' });
  await compare.click();
  await expect(panel.getByRole('button', { name: 'Hide comparison' })).toHaveAttribute('aria-pressed', 'true');
  await panel.getByRole('button', { name: 'Keep current edit' }).click();
  await expect(undo).toBeDisabled();
  await expect(panel.getByRole('group', { name: 'Suggested edit preview' })).toHaveCount(0);

  await suggest.click();
  await expect(panel.getByRole('group', { name: 'Suggested edit preview' })).toBeVisible({ timeout: 30_000 });
  await panel.getByRole('button', { name: 'Apply suggested edit' }).click();
  await expect(undo).toBeEnabled();
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  const exposure = page.getByRole('slider', { name: 'Exposure adjustment' });
  expect(Number(await exposure.inputValue())).toBeGreaterThan(0);
  await undo.click();
  await expect(exposure).toHaveValue('0');
});

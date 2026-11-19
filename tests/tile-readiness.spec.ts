import { expect, test } from '@playwright/test';

test('each tile shows its preview, cull and edit state, by shape as well as colour, with the same words for screen readers', async ({ page }) => {
  await page.goto('/');
  const picture = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 200;
    const c = canvas.getContext('2d')!; c.fillStyle = '#45607a'; c.fillRect(0, 0, 300, 200);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Tiles');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles({ name: 'tile.png', mimeType: 'image/png', buffer: Buffer.from(picture, 'base64') });
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 1' })).toBeVisible({ timeout: 30000 });

  const bar = page.getByTestId('photo-tile-readiness').first();
  const preview = bar.locator('span').nth(0);
  await expect(preview).toHaveAttribute('data-state', 'ready', { timeout: 20000 });
  // Ready is a solid, full-height bar; steps not done yet are a thin line: the difference is shape, not only colour.
  const height = (index: number) => bar.locator('span').nth(index).evaluate((element) => element.getBoundingClientRect().height);
  expect(await height(0)).toBeGreaterThan(await height(1));
  await expect(bar.locator('span').nth(1)).toHaveAttribute('data-state', 'not-yet');
  await expect(page.getByText('Preview ready to open. No cull scan recorded. No saved edits.')).toHaveCount(1);
});

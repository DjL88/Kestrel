import { expect, test } from '@playwright/test';

test.skip(({ viewport }) => (viewport?.width ?? 1280) < 768, 'desktop controls and photo-info sidebar');

test('Quick edits opens without culling buckets and provides a simple filter, photo info and editor Back arrow', async ({ page }) => {
  await page.goto('/');
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 400; canvas.height = 300;
    const paint = canvas.getContext('2d')!;
    paint.fillStyle = '#243a42'; paint.fillRect(0, 0, 400, 300);
    paint.fillStyle = '#e6a44d'; paint.fillRect(140, 70, 120, 180);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByTestId('quick-edit-input').setInputFiles({
    name: 'quick-bird.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64'),
  });
  // The photo opens straight in the editor. (The Quick edits page may only flash past on the way, so look for it after Back.)
  const editor = page.getByRole('region', { name: 'Photo editor' });
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByText('Quick edits', { exact: true })).toBeVisible();

  const nav = page.getByRole('navigation', { name: 'Photo collections' });
  const show = nav.getByRole('combobox', { name: 'Filter quick edits' });
  await expect(show).toHaveValue('all');
  await expect(nav.getByRole('button', { name: /To review|Keepers|Trash/ })).toHaveCount(0);
  await expect(page.getByText(/0\/50 keepers/)).toHaveCount(0);
  await expect(page.getByRole('region', { name: "What's next" })).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Photo info' })).toBeVisible();
  await show.selectOption('keep');
  await expect(show).toHaveValue('keep');
  await show.selectOption('all');
  await expect(show).toHaveValue('all');
});

import { expect, test } from '@playwright/test';

// K.8: the export focus point is kept, but its dot appears only while it is being placed or while the
// Export focus section is open. During normal editing the photo is not covered by it.
test('the export focus dot shows only while placing it or in the Export focus section', async ({ page }) => {
  await page.goto('/');
  const picture = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 600;
    const c = canvas.getContext('2d')!; c.fillStyle = '#3d5568'; c.fillRect(0, 0, 900, 600);
    c.fillStyle = '#d9a441'; c.fillRect(300, 200, 300, 200);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByTestId('quick-edit-input').setInputFiles({ name: 'focus.png', mimeType: 'image/png', buffer: Buffer.from(picture, 'base64') });
  await expect(page.getByRole('img', { name: 'Edited photo' })).toBeVisible({ timeout: 20000 });
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  const allControls = page.getByRole('button', { name: 'All controls' });
  if (await allControls.isVisible()) await allControls.click();

  const dot = page.getByTestId('export-focus-dot');
  const section = page.getByText('Export focus', { exact: true });
  await section.click();
  await page.getByRole('button', { name: 'Mark focus point' }).click();
  await page.getByRole('button', { name: 'Place export focus point' }).press('Enter');
  const move = page.getByRole('button', { name: 'Move focus point' });
  await expect(move).toBeVisible();
  // The section is still open, so the dot shows where the focus is.
  await expect(dot).toBeVisible();

  // Normal editing: section closed, the dot is gone but the point is kept.
  await section.click();
  await expect(dot).toHaveCount(0);
  await section.click();
  await expect(move).toBeVisible();
  await section.click();
  await expect(dot).toHaveCount(0);

  // Placing again shows it.
  await section.click();
  await move.click();
  await expect(page.getByRole('button', { name: 'Cancel placement' })).toBeVisible();
  await expect(dot).toBeVisible();
  await page.getByRole('button', { name: 'Cancel placement' }).click();

  // Another tab closes the section and hides the dot.
  await page.getByRole('tab', { name: 'Crop' }).click();
  await expect(dot).toHaveCount(0);
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  await expect(dot).toHaveCount(0);
});

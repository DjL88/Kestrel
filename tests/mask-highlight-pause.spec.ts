import { expect, test } from '@playwright/test';

test('the mask highlight steps aside while a mask slider moves, and comes back about 3 seconds later', async ({ page }) => {
  await page.goto('/');
  const picture = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 400;
    const c = canvas.getContext('2d')!;
    const g = c.createLinearGradient(0, 0, 600, 400); g.addColorStop(0, '#2d4256'); g.addColorStop(1, '#c8b48a');
    c.fillStyle = g; c.fillRect(0, 0, 600, 400);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByTestId('quick-edit-input').setInputFiles({ name: 'mask.png', mimeType: 'image/png', buffer: Buffer.from(picture, 'base64') });
  const masksTab = page.getByRole('tab', { name: 'Masks' });
  await masksTab.click({ timeout: 20000 });
  // On a phone, tapping the tab that is already open folds the sheet away; open it again if so.
  const panel = page.locator('#panel-masks');
  if (!(await panel.isVisible())) await masksTab.click();
  await panel.getByRole('button', { name: 'Oval', exact: true }).click();
  const overlay = page.getByTestId('mask-overlay');
  await expect(overlay).toBeVisible();

  const exposure = panel.getByRole('slider', { name: 'Exposure for this mask' });
  await exposure.focus();
  await page.keyboard.press('ArrowRight');
  await expect(overlay, 'hidden while the slider moves').toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(overlay).toHaveCount(0);
  // Back once the slider has been still for about 3 seconds.
  await expect(overlay).toBeVisible({ timeout: 6000 });
});

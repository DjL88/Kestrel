import { expect, test } from '@playwright/test';
import { openExportDialog } from './helpers';

test('an export shows in the task manager, finishes there, and can be cancelled from it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Tasks|task/ })).toHaveCount(0); // nothing running, nothing shown
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 2400; canvas.height = 1600;
    const c = canvas.getContext('2d')!; const g = c.createLinearGradient(0, 0, 2400, 1600); g.addColorStop(0, '#234'); g.addColorStop(1, '#da6'); c.fillStyle = g; c.fillRect(0, 0, 2400, 1600);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByTestId('quick-edit-input').setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await openExportDialog(page);
  await page.getByRole('button', { name: 'Instagram' }).click();
  await page.getByRole('checkbox', { name: /Post · 4:5/ }).check();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: /^Prepare 1 file/ }).click();
  const pill = page.getByRole('button', { name: /Tasks|task/ });
  await expect(pill).toBeVisible({ timeout: 15000 });
  await pill.click();
  const panel = page.getByRole('region', { name: 'Tasks' });
  await expect(panel).toContainText('Exporting 1 file');
  await expect(panel).toContainText('Finished', { timeout: 30000 });
  await panel.getByRole('button', { name: 'Clear finished' }).click();
  await expect(panel).toHaveCount(0); // with nothing left to show, the whole panel goes
});

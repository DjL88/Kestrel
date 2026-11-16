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
  // The export dialog shows its own progress. Once it is closed, the task manager shows the finished job.
  await expect(page.getByRole('status').filter({ hasText: '1 file ready' })).toBeVisible({ timeout: 30000 });
  await page.keyboard.press('Escape');
  const pill = page.getByRole('button', { name: /Tasks|task/ });
  await expect(pill).toBeVisible({ timeout: 15000 });
  await pill.click();
  const panel = page.getByRole('region', { name: 'Tasks' });
  await expect(panel).toContainText('Exporting 1 file');
  await expect(panel).toContainText('Finished', { timeout: 30000 });
  await panel.getByRole('button', { name: 'Clear finished' }).click();
  await expect(panel).toHaveCount(0); // with nothing left to show, the whole panel goes
});

test('adding photos shows in the task manager, and finishes there', async ({ page }) => {
  await page.goto('/');
  const png = (shade: number) => ({ name: `add-${shade}.png`, mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Adding');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  // Distinct file names, same tiny picture: the point is the task, not the pixels.
  await page.getByTestId('local-file-input').setInputFiles([png(1), png(2), png(3)].map((file, i) => ({ ...file, name: `add-${i + 1}.png`, buffer: Buffer.concat([file.buffer, Buffer.from([i])]) })));
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 3' })).toBeVisible({ timeout: 30000 });
  const pill = page.getByRole('button', { name: /Tasks|task/ });
  await pill.click();
  const panel = page.getByRole('region', { name: 'Tasks' });
  await expect(panel).toContainText('Adding 3 photos');
  await expect(panel).toContainText('Finished');
});

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
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(pill).toBeFocused();
  await pill.click();
  await panel.getByRole('button', { name: 'Clear finished' }).click();
  await expect(panel).toHaveCount(0); // with nothing left to show, the whole panel goes
});

test('a failed export stays visible after eleven seconds until its error is cleared', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles('tests/fixtures/exif-photo.jpg');
  await openExportDialog(page);
  await page.getByRole('button', { name: 'Full size', exact: true }).click();
  await page.getByRole('checkbox', { name: /Full size · PNG/ }).check();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.toBlob = () => { throw new Error('Synthetic export encoder failure'); };
  });
  await page.getByRole('button', { name: 'Prepare 1 file', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Synthetic export encoder failure');
  await page.getByRole('button', { name: 'Close export', exact: true }).click();
  await page.clock.install();
  await page.clock.fastForward(11_000);
  const pill = page.getByRole('button', { name: /Problem/ });
  await expect(pill).toBeVisible();
  await pill.click();
  const panel = page.getByRole('region', { name: 'Tasks' });
  await expect(panel).toContainText('Synthetic export encoder failure');
  await panel.getByRole('button', { name: 'Clear finished', exact: true }).click();
  await expect(pill).toHaveCount(0);
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

test('auto-cull can be stopped in its dialog and restarted without partial decisions', async ({ page, isMobile }) => {
  // Each scan hashes the two identical files to prove they are exact duplicates. Holding a hash keeps a scan
  // part-way through, so it can be stopped at a known point. holdNextCullHash() arms the next hold.
  await page.addInitScript(() => {
    const w = window as Window & { releaseCullHash?: () => void; holdNextCullHash?: () => void };
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    let hold = true;
    w.holdNextCullHash = () => { hold = true; };
    crypto.subtle.digest = async (...args: Parameters<SubtleCrypto['digest']>) => {
      if (hold) {
        hold = false;
        await new Promise<void>((resolve) => { w.releaseCullHash = () => { delete w.releaseCullHash; resolve(); }; });
      }
      return digest(...args);
    };
  });
  const held = () => page.evaluate(() => typeof (window as Window & { releaseCullHash?: () => void }).releaseCullHash);
  const release = () => page.evaluate(() => (window as Window & { releaseCullHash?: () => void }).releaseCullHash?.());
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Stoppable scan');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  const buffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await page.getByTestId('local-file-input').setInputFiles([
    { name: 'one.png', mimeType: 'image/png', buffer },
    { name: 'two.png', mimeType: 'image/png', buffer },
  ]);
  const collections = page.getByRole('navigation', { name: 'Photo collections' });
  const pill = page.getByRole('button', { name: /Tasks|Working|Busy|Stuck|Problem/ });
  const panel = page.getByRole('region', { name: 'Tasks' });

  // Since #376 a new import is reviewed by a background task, not a dialog. It is stopped from the task manager.
  await expect.poll(held).toBe('function');
  await pill.click();
  await panel.getByRole('button', { name: 'Cancel Reviewing imported photographs' }).click();
  await release();
  await expect(panel).toContainText('Cancelled');
  await expect(collections.getByRole('button', { name: 'To review 2', exact: true })).toBeVisible();
  await pill.click();
  await expect(panel).toHaveCount(0);

  // The explicit Auto-cull dialog can be stopped too, and leaves no partial decisions behind.
  await page.evaluate(() => (window as Window & { holdNextCullHash?: () => void }).holdNextCullHash?.());
  // On a phone the same menu opens from the footer's More button.
  await page.getByRole('button', { name: isMobile ? 'More' : 'Workspace options', exact: true }).click();
  await page.locator('#workspace-options').getByRole('button', { name: /Auto-cull/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Auto-cull' });
  await dialog.getByRole('button', { name: 'Scan photos', exact: true }).click();
  await expect.poll(held).toBe('function');
  await dialog.getByRole('button', { name: 'Stop scan', exact: true }).click();
  await release();
  await expect(dialog.getByRole('status')).toHaveText('Scan stopped. No results were applied. You can scan again.');
  await expect(dialog.getByRole('button', { name: 'Scan photos', exact: true })).toBeEnabled();
  await expect(collections.getByRole('button', { name: 'To review 2', exact: true })).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'Automatically move High confidence results' }).uncheck();
  await dialog.getByRole('button', { name: 'Scan photos', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Auto-cull summary' })).toContainText('Scan finished', { timeout: 30_000 });
  await dialog.getByRole('button', { name: 'Close auto-cull' }).click();
  await expect(collections.getByRole('button', { name: 'To review 2', exact: true })).toBeVisible();
  await pill.click();
  await expect(panel).toContainText('Cancelled');
  await expect(panel).toContainText('Finished');
  await expect(panel).not.toContainText('Stopped by a problem');
});

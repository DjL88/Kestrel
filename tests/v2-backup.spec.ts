import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop File menu.');
});

test('?v2 back up now, save a backup file, and restore it on the hub as a new project', async ({ page }) => {
  // Use the plain download path (no native save picker in a headless browser).
  await page.addInitScript(() => { delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker; });
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Backup check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const shot = readFileSync('tests/fixtures/exif-photo.jpg');
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'DSC_0007.jpg', mimeType: 'image/jpeg', buffer: shot }]);
  const options = root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option');
  await expect(options).toHaveCount(1, { timeout: 30000 });
  await options.first().click();
  await page.keyboard.press('f');

  // Back up now: a verified copy, said in words with the time.
  await root.getByRole('button', { name: 'File', exact: true }).click();
  await root.getByRole('menuitem', { name: 'Back up now' }).click();
  await expect(root.getByText(/Backed up at .*read back and matches|Backed up on this device/)).toBeVisible({ timeout: 20000 });
  await root.getByRole('button', { name: 'File', exact: true }).click();
  await expect(root.getByTestId('backup-note')).toContainText(/Backed up at|Backed up on this device/);

  // Save a backup file.
  const download = page.waitForEvent('download');
  await root.getByRole('menuitem', { name: 'Save backup file…' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Backup check.kestrel.json');
  const contents = readFileSync(await file.path());

  // Restore it on the hub: a new project opens with the photo and its flag; the first project is untouched.
  await root.getByRole('button', { name: 'Back to projects' }).click();
  await root.getByTestId('restore-backup-input').setInputFiles([{ name: 'Backup check.kestrel.json', mimeType: 'application/json', buffer: contents }]);
  await expect(root.getByText(/Restored “Backup check \(restored\)” as a new project/)).toBeVisible({ timeout: 20000 });
  await expect(options).toHaveCount(1, { timeout: 20000 });
  await expect(root.getByTestId('decision-filter-flagged')).toHaveText(/Flagged \(1\)/);
  await root.getByRole('button', { name: 'Back to projects' }).click();
  await expect(root.getByText('Backup check', { exact: true }).first()).toBeVisible();
  await expect(root.getByText('Backup check (restored)', { exact: true }).first()).toBeVisible();

  // A file that is not a backup changes nothing.
  await root.getByTestId('restore-backup-input').setInputFiles([{ name: 'nope.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') }]);
  await expect(root.getByText(/not a readable InFlight project backup/)).toBeVisible({ timeout: 20000 });
});

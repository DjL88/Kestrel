import { expect, test } from '@playwright/test';
import { openExportDialog } from './helpers';

const photo = { name: 'portrait.png', mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') };

async function openCompact(page: import('@playwright/test').Page, legacyChoices?: string[]) {
  await page.addInitScript((choices) => {
    localStorage.setItem('kestrel.exportView', 'list');
    if (choices) localStorage.setItem('kestrel.lastExport.v2', JSON.stringify(choices));
  }, legacyChoices);
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles(photo);
  await openExportDialog(page);
  return page.getByRole('dialog', { name: 'Export photo' });
}

test.describe('compact portrait export', () => {
  test.use({ viewport: { width: 390, height: 700 }, isMobile: true, hasTouch: true });

  test('the default export fits a phone: collapsed proof, shared sizes and separate advanced settings', async ({ page }) => {
    const dialog = await openCompact(page);
    await expect(dialog.getByRole('tablist', { name: 'Export settings' })).toBeVisible();
    const show = dialog.getByRole('button', { name: 'Show preview' });
    await expect(show).toBeVisible();
    await expect(show).toHaveAttribute('aria-expanded', 'false');
    await show.click();
    await expect(dialog.getByRole('button', { name: 'Hide preview' })).toHaveAttribute('aria-expanded', 'true');
    await dialog.getByRole('button', { name: 'Hide preview' }).click();

    await expect(dialog.locator('#export-form').getByRole('button', { name: 'Save original file' })).toBeVisible();
    const size = dialog.getByRole('checkbox', { name: /Post · 4:5/ });
    await expect(size).toBeVisible();
    await size.check();
    await dialog.getByRole('checkbox', { name: 'Full size · PNG' }).uncheck();
    await expect(dialog.getByRole('button', { name: 'Prepare 1 file' })).toBeVisible();

    await dialog.getByRole('tab', { name: 'Advanced', exact: true }).click();
    await expect(dialog.getByRole('checkbox', { name: 'Show text overlay' })).toBeVisible();
    await expect(dialog.getByText('Export presets', { exact: true })).toBeVisible();
    await dialog.getByRole('tab', { name: 'Export', exact: true }).click();
    await expect(size).toBeChecked();
    const exportTab = await dialog.getByRole('tab', { name: 'Export', exact: true }).boundingBox();
    expect(exportTab!.y + exportTab!.height).toBeLessThan(700);
    await expect(dialog.getByRole('button', { name: 'Close export' })).toBeVisible();
  });
});

test('shared social size shows three destination icons and prepares one output for legacy duplicate choices', async ({ page }) => {
  const dialog = await openCompact(page, ['ig-45', 'fb-45', 'tt-45']);
  const checkbox = dialog.getByRole('checkbox', { name: /Post · 4:5/ });
  await expect(checkbox).toBeChecked();
  const row = dialog.locator('label').filter({ has: checkbox });
  await expect(row.locator('svg')).toHaveCount(3);
  await expect(dialog.getByRole('button', { name: 'Prepare 1 file' })).toBeVisible();
});

test('the watermark offers Text and Picture side by side, so the picture (PNG, JPEG) option is not hidden in a menu', async ({ page }) => {
  const dialog = await openCompact(page);
  await dialog.getByRole('tab', { name: 'Advanced', exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'Add a watermark' }).check();
  const kind = dialog.getByRole('group', { name: 'Type' });
  const text = kind.getByRole('button', { name: 'Text', exact: true });
  const picture = kind.getByRole('button', { name: /^Picture/ });
  await expect(text).toHaveAttribute('aria-pressed', 'true');
  await expect(picture).toBeVisible();
  await picture.click();
  await expect(picture).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.locator('input[type="file"][accept*="image/png"]')).toBeVisible();
});

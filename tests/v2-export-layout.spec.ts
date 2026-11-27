import { test, expect } from '@playwright/test';

// Owner's Windows test, 26 Nov: Export reads Photos, Formats, Destination, then the Export button; versions, quality,
// size, 16-bit RAW and captions sit under Advanced, and captions say they only change the file's metadata.
test('?v2 Export shows Photos, Formats and Destination, with the rest under Advanced', async ({ page }) => {
  await page.goto('/?v2&stub=1&autostart=1');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: /^Export/ }).first().click();
  const dialog = page.getByRole('dialog', { name: /export/i });
  await expect(dialog).toBeVisible();

  const shown = (await dialog.getByRole('heading', { level: 3 }).allInnerTexts()).map((text) => text.trim());
  const order = ['Photos', 'Formats', 'Destination'].map((name) => shown.indexOf(name));
  expect(order.every((at) => at >= 0), `headings shown: ${shown.join(', ')}`).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);

  // Advanced starts closed: none of its controls are in the main view.
  const advanced = dialog.getByTestId('export-advanced');
  await expect(advanced).not.toHaveAttribute('open', '');
  await expect(dialog.getByRole('button', { name: /Original file: exact copy/ })).toBeHidden();
  await expect(dialog.getByTestId('export-captions')).toBeHidden();

  await advanced.getByText('Advanced', { exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Include versions' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Original file: exact copy/ })).toBeVisible();
  const captions = dialog.getByTestId('export-captions');
  await captions.getByText('Captions and credits', { exact: true }).click();
  await expect(captions.getByTestId('export-captions-metadata-only')).toHaveText(/only updates the file’s metadata/);

  // Closed and opened again, Advanced is as it was left.
  await dialog.getByRole('button', { name: 'Close export dialog' }).click();
  await root.getByRole('button', { name: /^Export/ }).first().click();
  await expect(page.getByRole('dialog', { name: /export/i }).getByTestId('export-advanced')).toHaveAttribute('open', '');
});

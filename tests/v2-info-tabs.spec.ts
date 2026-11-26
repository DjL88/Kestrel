import { test, expect } from '@playwright/test';

// Owner's Windows test, 26 Nov: Camera & Capture and Analysis Summary first; the histogram, the file and its
// connection, DNG copy and Edit in another app on a second tab.
test('?v2 Info opens on the camera and analysis; the histogram and file are on the second tab', async ({ page }) => {
  await page.goto('/?v2&stub=1&autostart=1');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'Info', exact: true }).first().click();

  const tabs = root.getByRole('tablist', { name: 'Photo information' });
  const details = tabs.getByRole('tab', { name: 'Details' });
  const fileTab = tabs.getByRole('tab', { name: 'File & histogram' });
  await expect(details).toHaveAttribute('aria-selected', 'true');

  const detailsView = root.getByRole('tabpanel', { name: 'Details' });
  const headings = detailsView.getByRole('heading');
  await expect(headings.nth(0)).toHaveText('Camera & Capture');
  await expect(headings.nth(1)).toHaveText('Analysis Summary');
  await expect(root.getByTestId('histogram-legend').or(root.getByText('Measuring…'))).toHaveCount(0);

  // Arrow keys move between the tabs, as a tab list should.
  await details.focus();
  await page.keyboard.press('ArrowRight');
  await expect(fileTab).toHaveAttribute('aria-selected', 'true');
  await expect(fileTab).toBeFocused();
  const fileView = root.getByRole('tabpanel', { name: 'File & histogram' });
  await expect(fileView.getByText('Histogram', { exact: true })).toBeVisible();
  await expect(fileView.getByRole('heading', { name: 'File & Connection' })).toBeVisible();
  await expect(fileView.getByRole('heading', { name: 'Camera & Capture' })).toHaveCount(0);

  await page.keyboard.press('ArrowLeft');
  await expect(details).toHaveAttribute('aria-selected', 'true');
});

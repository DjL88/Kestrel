import { expect, test } from '@playwright/test';
import { createDemoShootState } from '../src/core/cullingEngine';
import { encodeProjectBackup } from '../src/core/projectBackup';

test('desktop photo selection acts on all filtered photo records, never the page', async ({ page }) => {
  test.skip(test.info().project.name === 'phone', 'Native desktop Edit menu is not present on mobile.');
  const project = createDemoShootState(4);
  project.filter = 'all';

  await page.goto('/');
  await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles({
    name: 'menu-selection.kestrel.json',
    mimeType: 'application/json',
    buffer: Buffer.from(encodeProjectBackup(project)),
  });
  await page.getByRole('button', { name: 'All photos 4', exact: true }).click();

  // Simulate the command emitted by Tauri, not the browser text-selection shortcut.
  await page.evaluate(() => window.dispatchEvent(new Event('kestrel:photos-select-all')));
  await expect(page.getByText('4 selected', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit selected' })).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new Event('kestrel:photos-deselect-all')));
  await expect(page.getByText('4 selected', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit selected' })).toHaveCount(0);
});

import { expect, test } from '@playwright/test';
import { createDemoShootState } from '../src/core/cullingEngine';
import { encodeProjectBackup } from '../src/core/projectBackup';

test('desktop photo commands select catalogue records and export the full selection', async ({ page }) => {
  test.skip(test.info().project.name === 'phone', 'Native desktop menu contract');
  const project = createDemoShootState(4);
  project.shoot.title = 'Desktop command fixture';
  project.filter = 'all';
  await page.goto('/');
  await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles({
    name: 'native-menu.kestrel.json',
    mimeType: 'application/json',
    buffer: Buffer.from(encodeProjectBackup(project)),
  });
  await page.getByRole('button', { name: 'All photos 4', exact: true }).click();

  // Native menus deliver these application events; the test deliberately avoids
  // clicking labels which may change to "Export 4" with multi-selection.
  await page.evaluate(() => window.dispatchEvent(new Event('kestrel:photos-select-all')));
  await expect(page.getByText('4 selected', { exact: true })).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new Event('kestrel:desktop-export')));
  await expect(page.getByRole('heading', { name: 'Export 4 photos' })).toBeVisible();
  await page.getByRole('button', { name: 'Close export' }).click();

  await page.evaluate(() => window.dispatchEvent(new Event('kestrel:photos-deselect-all')));
  await expect(page.getByText('4 selected', { exact: true })).toHaveCount(0);
});

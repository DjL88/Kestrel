import { openExportDialog } from './helpers';
import { expect, test, type Page } from '@playwright/test';

const png = (shade: number) => ({ name: `shot-${shade}.png`, mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });

async function makeProject(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill(name);
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles([png(1), png(2)]);
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 2' })).toBeVisible({ timeout: 30_000 });
}


test('library on a phone: header stays put, a tap selects and a quick second tap opens the photo', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'touch behaviour');
  await makeProject(page, 'Library taps');
  const header = page.getByRole('banner');
  const before = await header.boundingBox();
  expect(before!.y).toBeLessThanOrEqual(1);
  await page.mouse.wheel(0, 600);
  const after = await header.boundingBox();
  expect(after!.y, 'the header does not scroll away').toBeLessThanOrEqual(1);
  const tile = page.getByRole('button', { name: /shot-1\.png/ }).first();
  await tile.tap();
  await expect(tile).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /^Back/ }).first()).toBeVisible();
  await tile.tap();
  await page.waitForTimeout(100);
  await tile.tap();
  await expect(page.getByRole('button', { name: 'Undo last decision' })).toBeVisible();
});

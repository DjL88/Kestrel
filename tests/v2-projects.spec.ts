import { expect, test } from '@playwright/test';

test('?v2 hub: rename, archive, restore and delete a project (originals untouched, delete is confirmed)', async ({ page }) => {
  await page.goto('/?v2&stub=1');
  const studio = page.locator('.inflight-v2');
  const first = studio.getByRole('button', { name: /^Project actions for / }).first();
  await expect(first).toBeVisible();
  const label = (await first.getAttribute('aria-label'))!.replace('Project actions for ', '');

  await first.click();
  await studio.getByRole('menuitem', { name: 'Rename' }).click();
  await page.getByLabel('Project name').fill('Renamed shoot');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(studio.getByRole('button', { name: 'Project actions for Renamed shoot' })).toBeVisible();

  await studio.getByRole('button', { name: 'Project actions for Renamed shoot' }).click();
  await studio.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(studio.getByRole('button', { name: 'Project actions for Renamed shoot' })).toHaveCount(0);
  await studio.getByRole('button', { name: /^Archived \(1\)/ }).click();
  await studio.getByRole('button', { name: 'Project actions for Renamed shoot' }).click();
  await studio.getByRole('menuitem', { name: 'Restore' }).click();
  await expect(studio.getByText('Nothing is archived.')).toBeVisible();
  await studio.getByRole('button', { name: 'Back to projects' }).click();

  await studio.getByRole('button', { name: 'Project actions for Renamed shoot' }).click();
  await studio.getByRole('menuitem', { name: /^Delete/ }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Your original photo files are never touched');
  await dialog.getByRole('button', { name: 'Keep project' }).click();
  await expect(studio.getByRole('button', { name: 'Project actions for Renamed shoot' })).toBeVisible();
  await studio.getByRole('button', { name: 'Project actions for Renamed shoot' }).click();
  await studio.getByRole('menuitem', { name: /^Delete/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete project' }).click();
  await expect(studio.getByRole('button', { name: 'Project actions for Renamed shoot' })).toHaveCount(0);
  expect(label.length).toBeGreaterThan(0);
});

test('?v2 settings: Privacy has a guarded erase-this-device and a forget-me request route', async ({ page }) => {
  await page.goto('/?v2&stub=1');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: /settings/i }).first().click();
  await page.getByRole('tab', { name: 'Privacy' }).or(page.getByRole('button', { name: 'Privacy' })).first().click();
  const erase = page.getByRole('button', { name: 'Erase this device' });
  await expect(erase).toBeDisabled();
  await page.getByLabel('Type ERASE to confirm').fill('ERASE');
  await expect(erase).toBeEnabled();
  await expect(page.getByRole('link', { name: 'Ask InFlight to erase my account data' })).toHaveAttribute('href', '/#contact');
});

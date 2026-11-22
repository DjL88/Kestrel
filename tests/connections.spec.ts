import { expect, test, type Page } from '@playwright/test';
import { ACCESS_KEY, SECRET_KEY, startMockS3, type MockS3 } from './mock-s3';

test.skip(({ viewport }) => (viewport?.width ?? 1280) < 768, 'the connections panel is exercised on desktop');

let s3: MockS3;
test.beforeEach(async () => { s3 = await startMockS3('photos'); });
test.afterEach(async () => { await s3?.close().catch(() => {}); });

/** "Where my work is kept" lives in Settings → Bring your own Storage, not on the Home screen. */
async function openStoragePanel(page: Page) {
  const panel = page.getByRole('region', { name: 'Where my work is kept' });
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Connectivity' }).click();
    await page.getByRole('button', { name: /Bring your own Storage/ }).click();
  }
  return panel;
}

async function addS3(page: Page, name: string, secret = SECRET_KEY) {
  const panel = await openStoragePanel(page);
  await panel.getByRole('button', { name: 'Add a connection' }).click();
  const group = panel.getByRole('group', { name: 'Add a connection' });
  await group.getByRole('radio', { name: /My cloud storage/ }).check();
  await group.getByLabel(/Name it/).fill(name);
  const form = group.getByRole('form', { name: 'Your cloud storage' });
  await form.getByLabel('Storage address').fill(s3.endpoint);
  await form.getByLabel('Region', { exact: true }).fill('eu-west-2');
  await form.getByLabel('Bucket', { exact: true }).fill('photos');
  await form.getByLabel('Access key', { exact: true }).fill(ACCESS_KEY);
  await form.getByLabel('Secret key', { exact: true }).fill(secret);
  await form.getByRole('button', { name: 'Save' }).click();
  return panel;
}

test('a connection is added, checked, and shown as connected; Dropbox and Google Drive are listed as coming', async ({ page }) => {
  await page.goto('/');
  const panel = await openStoragePanel(page);
  await expect(panel).toContainText('Nothing connected yet');
  await panel.getByRole('button', { name: 'Add a connection' }).click();
  for (const name of [/^Dropbox/, /^Google Drive/, /^Microsoft OneDrive/]) await expect(panel.getByRole('radio', { name })).toBeDisabled();
  await expect(panel.getByRole('radio', { name: /^A NAS or server over WebDAV/ })).toBeEnabled();
  await panel.getByRole('button', { name: 'Add a connection' }).click(); // close
  await addS3(page, 'Home NAS');
  await expect(panel.getByRole('status', { name: 'Home NAS: Connected' })).toBeVisible({ timeout: 15000 });
  expect(s3.refused).toBe(0);
});

test('wrong keys show as "Sign in again", and stopping the storage shows "Offline"; neither loses anything', async ({ page }) => {
  await page.goto('/');
  const panel = await addS3(page, 'Work drive', 'not-the-secret');
  await expect(panel.getByRole('status', { name: 'Work drive: Sign in again' })).toBeVisible({ timeout: 15000 });
  await expect(panel).toContainText('keys');
  await panel.getByRole('button', { name: 'Remove Work drive' }).click();
  await expect(panel).toContainText('Nothing connected yet');

  await addS3(page, 'Home NAS');
  await expect(panel.getByRole('status', { name: 'Home NAS: Connected' })).toBeVisible({ timeout: 15000 });
  await s3.close();
  await panel.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(panel.getByRole('status', { name: 'Home NAS: Offline' })).toBeVisible({ timeout: 15000 });
  await expect(panel).toContainText('Could not reach the storage');
});

test('connections survive a reload, and keys that were not remembered ask to be entered again', async ({ page }) => {
  await page.goto('/');
  await addS3(page, 'Home NAS');
  await page.reload();
  const panel = await openStoragePanel(page);
  await expect(panel.getByText('Home NAS')).toBeVisible();
  // The keys were for this session only, so after a reload the connection says so rather than failing.
  await expect(panel.getByRole('status', { name: 'Home NAS: Sign in again' })).toBeVisible({ timeout: 15000 });
  await expect(panel).toContainText('not remembered');
});

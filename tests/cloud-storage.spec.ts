import { expect, test, type Page } from '@playwright/test';
import { ACCESS_KEY, SECRET_KEY, startMockS3, type MockS3 } from './mock-s3';

test.skip(({ viewport }) => (viewport?.width ?? 1280) < 768, 'the sync dialog is exercised on desktop; the phone menu differs');

let s3: MockS3;
test.beforeAll(async () => { s3 = await startMockS3('photos'); });
test.afterAll(async () => { await s3.close(); });

const photo = { name: 'cloud.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') };

async function openCloud(page: Page) {
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles(photo);
  await page.getByRole('button', { name: 'Back', exact: true }).click({ timeout: 15000 });
  await page.getByRole('button', { name: 'More', exact: true }).or(page.getByRole('button', { name: 'Workspace options' })).click();
  await page.locator('#workspace-options').getByRole('button', { name: /Sync folder or cloud/ }).click();
  const dialog = page.getByRole('dialog', { name: /Sync folder/ });
  await dialog.getByRole('radio', { name: 'My cloud storage' }).click();
  return dialog;
}

async function fill(dialog: ReturnType<Page['getByRole']>, secret = SECRET_KEY) {
  const form = dialog.getByRole('form', { name: 'Your cloud storage' });
  await form.getByLabel('Storage address').fill(s3.endpoint);
  await form.getByLabel('Region', { exact: true }).fill('eu-west-2');
  await form.getByLabel('Bucket', { exact: true }).fill('photos');
  await form.getByLabel('Access key', { exact: true }).fill(ACCESS_KEY);
  await form.getByLabel('Secret key', { exact: true }).fill(secret);
  return form;
}

test('your own S3-compatible storage: test, save, send a project, and bring it back', async ({ page }) => {
  const dialog = await openCloud(page);
  const form = await fill(dialog);
  await form.getByRole('button', { name: 'Test connection' }).click();
  await expect(form.getByRole('status')).toContainText('Connected');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('status').filter({ hasText: 'Using bucket' })).toContainText('photos');

  await dialog.getByRole('button', { name: 'Send this project to my cloud storage' }).click();
  await expect(dialog.getByRole('status').filter({ hasText: 'Saved 1 photos' })).toBeVisible();
  // The file is in the bucket, in the shared layout, and every request was correctly signed.
  const key = [...s3.objects.keys()].find((name) => name.startsWith('kestrel/v1/recipes/'));
  expect(key).toBeTruthy();
  expect(JSON.parse(s3.objects.get(key!)!.toString()).format).toBe('kestrel-project-sync');
  expect(s3.refused).toBe(0);
  // The secret key is not in the bucket or in anything sent, only the signature.
  expect(s3.objects.get(key!)!.toString()).not.toContain(SECRET_KEY);

  await dialog.getByRole('button', { name: 'Bring changes from my cloud storage' }).click();
  await expect(dialog.getByRole('group', { name: 'Confirm bringing changes' })).toBeVisible();
});

test('wrong keys are refused with a plain message, and nothing is saved to the bucket', async ({ page }) => {
  const before = s3.objects.size;
  const dialog = await openCloud(page);
  const form = await fill(dialog, 'not-the-secret');
  await form.getByRole('button', { name: 'Test connection' }).click();
  await expect(form.getByRole('alert')).toContainText('did not accept the keys');
  expect(s3.objects.size).toBe(before);
});

test('the secret key is kept only for the session unless the person chooses to remember it', async ({ page }) => {
  const dialog = await openCloud(page);
  const form = await fill(dialog);
  await form.getByRole('button', { name: 'Save' }).click();
  expect(await page.evaluate(() => localStorage.getItem('kestrel.cloud.v1'))).toBeNull();
  await dialog.getByRole('button', { name: 'Change', exact: true }).click();
  await dialog.getByRole('form', { name: 'Your cloud storage' }).getByRole('checkbox', { name: /Remember these on this device/ }).check();
  await dialog.getByRole('form', { name: 'Your cloud storage' }).getByRole('button', { name: 'Save' }).click();
  expect(await page.evaluate(() => localStorage.getItem('kestrel.cloud.v1'))).toContain('photos');
  await dialog.getByRole('button', { name: 'Change', exact: true }).click();
  await dialog.getByRole('form', { name: 'Your cloud storage' }).getByRole('button', { name: 'Forget these details' }).click();
  expect(await page.evaluate(() => localStorage.getItem('kestrel.cloud.v1'))).toBeNull();
});

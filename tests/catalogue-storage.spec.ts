import { expect, test } from '@playwright/test';

test('catalogue storage only requests protection on demand and reflects the browser result', async ({ page }) => {
  await page.addInitScript(() => {
    const storage = navigator.storage;
    Object.defineProperty(storage, 'persisted', {
      value: async () => localStorage.getItem('test-persistent-storage') === 'true',
    });
    Object.defineProperty(storage, 'persist', {
      value: async () => {
        const granted = localStorage.getItem('test-persistence-requested') === 'true';
        localStorage.setItem('test-persistence-requested', 'true');
        localStorage.setItem('test-persistent-storage', String(granted));
        return granted;
      },
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Storage fixture');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Back to projects' }).click();

  const request = page.getByRole('button', { name: 'Request persistent storage' });
  await expect(request).toBeHidden();
  await page.getByText('Browser storage & backups', { exact: true }).click();
  await expect(page.getByText(/Browser storage can be cleared by your device/)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('test-persistence-requested'))).toBeNull();

  await request.click();
  await expect(page.getByText(/The browser did not grant persistent storage/)).toBeVisible();
  await request.click();
  await expect(page.getByText(/Kestrel's browser storage is protected from routine clean-up/)).toBeVisible();

  await page.reload();
  await page.getByText('Browser storage & backups', { exact: true }).click();
  await expect(page.getByText(/Kestrel's browser storage is protected from routine clean-up/)).toBeVisible();
});

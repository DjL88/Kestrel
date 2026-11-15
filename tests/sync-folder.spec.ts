import { expect, test, type Page } from '@playwright/test';

// Chrome's folder picker cannot be driven, so the test hands the page a private in-browser folder instead.
async function useFolder(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory();
      return root.getDirectoryHandle('sync-test', { create: true });
    };
  });
}

const photo = { name: 'sync.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') };

async function openSync(page: Page) {
  await page.getByTestId('quick-edit-input').setInputFiles(photo);
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'More', exact: true }).or(page.getByRole('button', { name: 'Workspace options' })).click();
  await page.locator('#workspace-options').getByRole('button', { name: /Sync folder/ }).click();
  return page.getByRole('dialog', { name: 'Sync folder' });
}

test('a project is sent to a folder and brought back with a confirmation first', async ({ page }) => {
  test.skip(test.info().project.name === 'phone', 'the menu layout differs on phone; covered on desktop');
  await useFolder(page);
  await page.goto('/');
  let dialog = await openSync(page);
  await dialog.getByRole('button', { name: 'Send this project to a folder' }).click();
  await expect(dialog.getByRole('status')).toContainText('Saved 1 photos');
  await dialog.getByRole('button', { name: 'Bring changes from a folder' }).click();
  await expect(dialog.getByRole('group', { name: 'Confirm bringing changes' })).toContainText('matching photos would change');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  dialog = page.getByRole('dialog', { name: 'Sync folder' });
  await expect(dialog).toHaveCount(0);
});

test('bringing changes from a folder with no saved copy says so', async ({ page }) => {
  test.skip(test.info().project.name === 'phone', 'the menu layout differs on phone; covered on desktop');
  await useFolder(page);
  await page.goto('/');
  await page.evaluate(async () => { const root = await navigator.storage.getDirectory(); await root.removeEntry('sync-test', { recursive: true }).catch(() => {}); });
  const dialog = await openSync(page);
  await dialog.getByRole('button', { name: 'Bring changes from a folder' }).click();
  await expect(dialog.getByRole('status')).toContainText('has no saved copy');
});

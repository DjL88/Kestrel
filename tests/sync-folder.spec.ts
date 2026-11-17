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

test('sending never silently replaces another project’s saved copy with the same name', async ({ page }) => {
  test.skip(test.info().project.name === 'phone', 'the menu layout differs on phone; covered on desktop');
  await useFolder(page);
  await page.goto('/');
  // Another project's copy, saved under the same file name, with photos that are not in this project.
  await page.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('sync-test', { create: true });
    let dir = root;
    for (const part of ['kestrel', 'v1', 'recipes', 'quick-edits']) dir = await dir.getDirectoryHandle(part, { create: true });
    const file = await dir.getFileHandle('project.json', { create: true });
    const writable = await file.createWritable();
    const photos = ['a', 'b', 'c', 'd'].map((n) => ({ key: `other-${n}`, decision: 'keep', identity: `other-${n}.jpg|1` }));
    await writable.write(JSON.stringify({ format: 'kestrel-project-sync', version: 1, title: 'Quick edits', savedAt: new Date().toISOString(), projectId: 'someone-else', photos }));
    await writable.close();
  });
  const dialog = await openSync(page);
  await dialog.getByRole('button', { name: 'Send this project to a folder' }).click();
  const confirm = dialog.getByRole('group', { name: 'Confirm replacing a saved copy' });
  await expect(confirm).toContainText('different project');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  const kept = await page.evaluate(async () => {
    let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sync-test');
    for (const part of ['kestrel', 'v1', 'recipes', 'quick-edits']) dir = await dir.getDirectoryHandle(part);
    return (await (await dir.getFileHandle('project.json')).getFile()).text();
  });
  expect(kept).toContain('someone-else');
});

test('keyboard focus stays inside the Sync folder dialog: Tab from the last control wraps to the first', async ({ page }) => {
  test.skip(test.info().project.name === 'phone', 'the menu layout differs on phone; covered on desktop');
  await useFolder(page);
  await page.goto('/');
  const dialog = await openSync(page);
  const focusable = dialog.locator('button:not([disabled]), input:not([disabled]), a[href]');
  await focusable.last().focus();
  await page.keyboard.press('Tab');
  await expect(focusable.first()).toBeFocused();
});

import { expect, test, type Page } from '@playwright/test';

// The folder picker cannot be driven, so the page is given a private in-browser folder to watch instead.
async function useFolder(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory();
      return root.getDirectoryHandle('watch-test', { create: true });
    };
  });
}
const photo = { name: 'start.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') };

async function drop(page: Page, name: string, shade: number) {
  await page.evaluate(async ({ name, shade }) => {
    const canvas = document.createElement('canvas'); canvas.width = 40; canvas.height = 30;
    const c = canvas.getContext('2d')!; c.fillStyle = `rgb(${shade},90,40)`; c.fillRect(0, 0, 40, 30);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('watch-test', { create: true });
    const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
    await writable.write(blob); await writable.close();
  }, { name, shade });
}

test('photos that arrive in a watched folder are added to the project, once each, and watching can be stopped', async ({ page }) => {
  test.skip(test.info().project.name === 'phone', 'the menu layout differs on phone; covered on desktop');
  await useFolder(page);
  await page.goto('/');
  await page.evaluate(async () => { await (await navigator.storage.getDirectory()).removeEntry('watch-test', { recursive: true }).catch(() => {}); });
  await page.getByTestId('quick-edit-input').setInputFiles(photo);
  await page.getByRole('button', { name: 'Back', exact: true }).click({ timeout: 15000 });
  const openMenu = () => page.getByRole('button', { name: 'More', exact: true }).or(page.getByRole('button', { name: 'Workspace options' })).click();
  await openMenu();
  await page.locator('#workspace-options').getByRole('button', { name: /Watch a folder for new photos/ }).click();
  await page.getByRole('dialog', { name: 'Watch a folder for new photos' }).getByRole('button', { name: 'Watch for new photos only' }).click();
  const status = page.getByRole('status').filter({ hasText: 'Watching “watch-test”' });
  await expect(status).toContainText('0 new photos added');
  await drop(page, 'arrive-1.png', 200);
  await drop(page, 'arrive-2.png', 120);
  await expect(status).toContainText('2 new photos added', { timeout: 20000 });
  await page.waitForTimeout(4500);
  await expect(status).toContainText('2 new photos added'); // nothing is imported twice
  await openMenu();
  await page.locator('#workspace-options').getByRole('button', { name: /Stop watching/ }).click();
  await expect(status).toHaveCount(0);
});

test('keyboard focus stays inside the Watch folder dialog: Tab from the last control wraps to the first', async ({ page }) => {
  test.skip(test.info().project.name === 'phone', 'the menu layout differs on phone; covered on desktop');
  await useFolder(page);
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles(photo);
  await page.getByRole('button', { name: 'Back', exact: true }).click({ timeout: 15000 });
  await page.getByRole('button', { name: 'More', exact: true }).or(page.getByRole('button', { name: 'Workspace options' })).click();
  await page.locator('#workspace-options').getByRole('button', { name: /Watch a folder for new photos/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Watch a folder for new photos' });
  const focusable = dialog.locator('button:not([disabled]), input:not([disabled]), a[href]');
  await focusable.last().focus();
  await page.keyboard.press('Tab');
  await expect(focusable.first()).toBeFocused();
});

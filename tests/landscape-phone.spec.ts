import { expect, test } from '@playwright/test';

const photo = { name: 'land.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') };

test.describe('a phone turned sideways', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  test('starts without the filmstrip, so the photo gets the room, and it can be pinned', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('quick-edit-input').setInputFiles(photo);
    await page.getByRole('tab', { name: 'Edit' }).click({ timeout: 20000 });
    await expect(page.getByRole('button', { name: /Expand filmstrip/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Collapse filmstrip/ })).toHaveCount(0);
  });
});

test.describe('a desktop window', () => {
  test.use({ viewport: { width: 1280, height: 390 } });
  test('still starts with the filmstrip when the window is short but used with a mouse', async ({ page }, info) => {
    test.skip(info.project.name === 'phone', 'the phone project is a touch device');
    await page.goto('/');
    await page.getByTestId('quick-edit-input').setInputFiles(photo);
    await page.getByRole('tab', { name: 'Edit' }).click({ timeout: 20000 });
    await expect(page.getByRole('button', { name: /Collapse filmstrip/ })).toBeVisible();
  });
});

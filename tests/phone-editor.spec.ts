import { expect, test, type Page } from '@playwright/test';

const photo = { name: 'one.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') };

async function openEditor(page: Page) {
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles(photo);
  await page.getByRole('tab', { name: 'Edit' }).click({ timeout: 20000 });
  await expect(page.locator('[data-hide-on-phone-edit]').first()).toBeAttached();
}
const displays = (page: Page) => page.locator('[data-hide-on-phone-edit]').evaluateAll((els) => els.map((el) => getComputedStyle(el).display));

test('on a phone the edit screen hides the filmstrip, Keep and Reject, Jump and Select photos', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'this is the phone layout');
  await openEditor(page);
  const shown = await displays(page);
  expect(shown.length).toBeGreaterThanOrEqual(3);
  expect(shown.every((value) => value === 'none')).toBe(true);
  // Previous and next stay, so editing can move along the photos without going back to the library.
  await expect(page.getByRole('button', { name: /^Previous/ })).toBeVisible();
});

test('on a desktop the same tools stay available while editing', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'this is the desktop layout');
  await openEditor(page);
  const shown = await displays(page);
  expect(shown.length).toBeGreaterThanOrEqual(3);
  expect(shown.some((value) => value === 'none')).toBe(false);
});

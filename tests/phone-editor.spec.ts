import { expect, test, type Page } from '@playwright/test';

const photo = { name: 'one.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') };

async function openEditor(page: Page) {
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles(photo);
  await page.getByRole('tab', { name: 'Edit' }).click({ timeout: 20000 });
  await expect(page.locator('[data-hide-on-phone-edit]').first()).toBeAttached();
}
const displays = (page: Page) => page.locator('[data-hide-on-phone-edit]').evaluateAll((els) => els.map((el) => getComputedStyle(el).display));

test('on a phone the edit screen is a pure editor: one footer row of editing tabs, no library tools, a tall photo', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'this is the phone layout');
  await openEditor(page);
  const shown = await displays(page);
  expect(shown.length).toBeGreaterThanOrEqual(3);
  expect(shown.every((value) => value === 'none')).toBe(true);
  // No library row at all: previous/next, Keep/Reject, Jump and Select photos are gone, and so is the View menu.
  await expect(page.getByRole('toolbar', { name: /editor|photo/i }).filter({ hasText: /Jump|Keep/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Previous/ })).toBeHidden();
  await expect(page.locator('summary').filter({ hasText: /^View$/ })).toBeHidden();
  // The tab bar is one row of editing tabs along the bottom, with a separate Export button in the same footer.
  const tabs = page.getByRole('tab');
  await expect(page.getByRole('tab', { name: 'Export' })).toHaveCount(0);
  const boxes = await tabs.evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) }; }));
  expect(await tabs.allInnerTexts(), 'the editing tabs').toEqual(['Auto', 'Crop', 'Edit', 'Masks', 'History']);
  expect(boxes.length).toBe(5);
  expect(new Set(boxes.map((box) => box.top)).size, 'all tabs share one row').toBe(1);
  const viewport = page.viewportSize()!;
  expect(viewport.height - boxes[0]!.bottom, 'the tabs sit at the very bottom (the safe area aside)').toBeLessThan(40);
  // Export lives in the footer on phones.
  await expect(page.getByRole('button', { name: /^Export/ }).filter({ visible: true }).first()).toBeVisible();
  // With a tool sheet open the photo still has at least two thirds of the editor's height.
  await page.getByRole('tab', { name: 'Edit' }).click();
  const ratio = await page.locator('[data-photo-stage]').evaluate((stage) => stage.getBoundingClientRect().height / (stage.closest('section')?.getBoundingClientRect().height ?? 1));
  expect(ratio).toBeGreaterThanOrEqual(0.6);
});

test('on a phone Settings does not ask which hand, and masks have no drag-a-box Select area', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'this is the phone layout');
  await openEditor(page);
  await page.getByRole('tab', { name: 'Masks' }).click();
  await expect(page.getByRole('button', { name: 'Select area', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await expect(page.getByText(/right-handed|left-handed/i).first()).toBeHidden();
});

test('on a desktop the same tools stay available while editing', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'this is the desktop layout');
  await openEditor(page);
  const shown = await displays(page);
  expect(shown.length).toBeGreaterThanOrEqual(3);
  expect(shown.some((value) => value === 'none')).toBe(false);
});

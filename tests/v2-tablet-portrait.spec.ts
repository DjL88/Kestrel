import { expect, test } from '@playwright/test';

// Owner-approved layout job (C): a touch tablet held upright gets the phone's bottom tool bar with more buttons, tools
// open as a half-height bottom sheet with the filmstrip out of the way, and Import moves to the top bar. Held sideways
// it keeps the desktop layout.
test('upright tablet: Import in the top bar, six tools along the bottom, a half-height sheet above which the photo stays', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'A touch tablet (the phone project has touch).');
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto('/?v2&stub=1');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: 'Cairngorms Pinewood Stags', exact: true }).or(studio.getByRole('button', { name: /Open studio/ }).first()).first().click();

  await expect(studio.getByRole('banner').getByTestId('topbar-import')).toBeVisible();
  await expect(studio.getByRole('complementary', { name: 'Studio tools' })).toHaveCount(0);
  const tools = studio.getByRole('navigation', { name: 'Mobile studio tools' });
  for (const name of ['Flight', 'Adjust', 'Formats', 'Masks', 'Enhance', 'More']) {
    await expect(tools.getByRole('button', { name, exact: true })).toBeVisible();
  }

  await tools.getByRole('button', { name: 'Adjust', exact: true }).click();
  await expect(studio.getByRole('heading', { name: 'Adjust', level: 2 })).toBeVisible();
  const sheet = (await studio.getByTestId('mobile-sheet-handle').locator('xpath=..').boundingBox())!;
  expect(sheet.height).toBeGreaterThan(1180 * 0.45);
  expect(sheet.height).toBeLessThan(1180 * 0.55);
  await expect(studio.locator('.v2-filmstrip')).toBeHidden();
  const frame = studio.getByTestId('canvas-frame');
  await expect.poll(async () => { const box = (await frame.boundingBox())!; return box.y + box.height; }).toBeLessThanOrEqual(sheet.y + 1);

  await studio.getByRole('button', { name: 'Close mobile drawer' }).click();
  await expect(studio.locator('.v2-filmstrip')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(820);
});

test('tablet held sideways keeps the desktop layout: the rail, no bottom tool bar', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'A touch tablet (the phone project has touch).');
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto('/?v2&stub=1');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: /Open studio/ }).first().click();
  await expect(studio.getByRole('complementary', { name: 'Studio tools' })).toBeVisible();
  await expect(studio.getByRole('navigation', { name: 'Mobile studio tools' })).toHaveCount(0);
  await expect(studio.getByTestId('topbar-import')).toHaveCount(0);
});

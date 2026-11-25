import { expect, test } from '@playwright/test';

// Tracker row x-phone-notice-overlap: on a phone a notice sat over the filmstrip and blocked long-press on the
// thumbnails until it was dismissed. A notice now sits above the filmstrip, and stays readable and dismissable.
test('phone: a notice never covers the filmstrip, and long-press on a thumbnail works while it shows', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Phone layout only.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?v2&stub=1');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: 'Cairngorms Pinewood Stags', exact: true }).click();

  // The sample workspace answers Folder with a notice.
  await studio.getByRole('button', { name: /^(Folder|Add photographs from a folder)$/ }).first().click();
  // Found by what a screen reader meets: a status (or alert) carrying the message.
  const notice = studio.locator('[role="status"], [role="alert"]').filter({ hasText: 'Folder import is available' });
  await expect(notice).toBeVisible();

  const strip = studio.getByRole('listbox', { name: 'Project photographs' });
  const noticeBox = (await notice.boundingBox())!;
  const stripBox = (await studio.locator('.v2-filmstrip').boundingBox())!;
  expect(noticeBox.y + noticeBox.height).toBeLessThanOrEqual(stripBox.y);

  // Long-press the second thumbnail with real touch events: the photo menu opens, with the notice still showing.
  const second = strip.getByRole('option').nth(1);
  const tile = (await second.boundingBox())!;
  const cdp = await context.newCDPSession(page);
  const point = { x: tile.x + tile.width / 3, y: tile.y + tile.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  const menu = page.getByRole('menu', { name: 'Photo actions' });
  await expect(menu).toBeVisible();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(menu).toBeVisible();
  await expect(notice).toBeVisible();

  // Still dismissable by its own button.
  await page.keyboard.press('Escape');
  await notice.getByRole('button').click();
  await expect(notice).toHaveCount(0);
});

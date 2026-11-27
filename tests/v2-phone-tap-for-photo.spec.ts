import { expect, test, type Page } from '@playwright/test';

// Tap for photo (preview `tapForPhoto`, off by default): on a touch screen one clean tap on the photo hides the bars and
// panels so the photo has the screen, and a tap brings them back. "Show panels" stays as the visible way back.
const FLAG = 'kestrel.preview.tap-for-photo.v1';

async function openStudio(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?v2&stub=1');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: 'Cairngorms Pinewood Stags', exact: true }).click();
  await expect(studio.getByTestId('canvas-frame')).toBeVisible();
  return studio;
}

async function tapPhoto(page: Page) {
  const box = (await page.locator('.inflight-v2').getByTestId('canvas-frame').boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

test('switched on: a tap gives the photo the screen and a tap brings the bars back', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Touch layout only.');
  await page.addInitScript((key) => localStorage.setItem(key, '1'), FLAG);
  const studio = await openStudio(page);
  const strip = studio.getByRole('listbox', { name: 'Project photographs' });
  await expect(strip).toBeVisible();
  const before = (await studio.getByTestId('canvas-frame').boundingBox())!;

  await tapPhoto(page);
  await expect(studio.getByTestId('canvas-only-exit')).toBeVisible();
  await expect(strip).toHaveCount(0);
  await expect(studio.getByTestId('phone-photo-title')).toHaveCount(0);
  await expect(studio.getByTestId('canvas-viewport-controls')).toBeHidden();
  const stage = (await studio.getByTestId('canvas-stage').boundingBox())!;
  expect(stage.height).toBeGreaterThan(844 * 0.8);
  await expect.poll(async () => (await studio.getByTestId('canvas-frame').boundingBox())!.height).toBeGreaterThan(before.height);

  await tapPhoto(page);
  await expect(studio.getByTestId('canvas-only-exit')).toHaveCount(0);
  await expect(strip).toBeVisible();
  await expect(studio.getByTestId('phone-photo-title')).toBeVisible();
});

test('switched on: the Show panels button is a way back without a gesture', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Touch layout only.');
  await page.addInitScript((key) => localStorage.setItem(key, '1'), FLAG);
  const studio = await openStudio(page);
  await tapPhoto(page);
  await studio.getByTestId('canvas-only-exit').click();
  await expect(studio.getByRole('listbox', { name: 'Project photographs' })).toBeVisible();
});

test('off by default: a tap on the photo changes nothing', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Touch layout only.');
  const studio = await openStudio(page);
  await tapPhoto(page);
  await page.waitForTimeout(500);
  await expect(studio.getByTestId('canvas-only-exit')).toHaveCount(0);
  await expect(studio.getByRole('listbox', { name: 'Project photographs' })).toBeVisible();
});

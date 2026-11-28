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

test('switched on: with the bars hidden the photo can still be flagged, and its place is shown', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Touch layout only.');
  await page.addInitScript((key) => localStorage.setItem(key, '1'), FLAG);
  const studio = await openStudio(page);
  await tapPhoto(page);
  const place = studio.getByTestId('canvas-only-position');
  await expect(place).toHaveText(/^1 of \d+$/);
  const flag = studio.getByTestId('canvas-only-flag');
  const was = await flag.getAttribute('aria-pressed');
  await flag.click();
  // The flag changed for this photo (the bars stay hidden); with "next after a decision" on, the next photo is shown.
  await expect(studio.getByTestId('canvas-only-exit')).toBeVisible();
  if ((await place.textContent())!.startsWith('1 of')) await expect(flag).toHaveAttribute('aria-pressed', was === 'true' ? 'false' : 'true');
  else await expect(place).toHaveText(/^2 of \d+$/);
  // Back with the bars: the first photo's tile carries the new flag.
  await studio.getByTestId('canvas-only-exit').click();
  const first = studio.getByRole('listbox', { name: 'Project photographs' }).getByRole('option').first();
  await expect(first.getByRole('button', { name: was === 'true' ? /^Flag / : /^Unflag / })).toBeVisible();
});

test('switched on: a double-tap still zooms, and the bars stay', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Touch layout only.');
  await page.addInitScript((key) => localStorage.setItem(key, '1'), FLAG);
  const studio = await openStudio(page);
  const zoom = studio.getByTestId('zoom-percent');
  const before = await zoom.innerText();
  const box = (await studio.getByTestId('canvas-frame').boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.touchscreen.tap(x, y);
  await page.waitForTimeout(250);
  await page.touchscreen.tap(x, y);
  await page.waitForTimeout(600);
  await expect(studio.getByTestId('canvas-only-exit')).toHaveCount(0);
  await expect(studio.getByRole('listbox', { name: 'Project photographs' })).toBeVisible();
  expect(await zoom.innerText()).not.toBe(before);
});

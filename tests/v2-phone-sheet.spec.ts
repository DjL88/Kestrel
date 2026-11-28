import { expect, test } from '@playwright/test';

// Phone tool sheet (mobile editor pass, 27 Nov): the Adjust sheet is a 44px title row with a grip, the first slider is
// whole and under the thumb as soon as Advanced Edits opens, every slider is a 44px touch target with a 6px track, and
// the "double-click" tip is left out on a touch screen. Measured in the phone project (coarse pointer).
test('phone Adjust sheet: slim title row, first slider whole in view, 44px sliders', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Phone layout only.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?v2&stub=1');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: 'Cairngorms Pinewood Stags', exact: true }).click();
  await studio.getByRole('navigation', { name: 'Mobile studio tools' }).getByRole('button', { name: 'Adjust' }).tap();

  const handle = studio.getByTestId('mobile-sheet-handle');
  await expect(handle).toBeVisible();
  const handleBox = (await handle.boundingBox())!;
  expect(handleBox.height, 'the title row, grip and Close share one line').toBeGreaterThanOrEqual(44);
  expect(handleBox.height).toBeLessThanOrEqual(48);

  await studio.getByRole('tab', { name: 'Advanced Edits' }).tap();
  const sheet = (await handle.locator('xpath=..').boundingBox())!;
  const slider = studio.locator('input[type="range"]').first();
  const sliderBox = (await slider.boundingBox())!;
  expect(sliderBox.height, 'a finger finds the slider').toBeGreaterThanOrEqual(44);
  expect(sliderBox.y + sliderBox.height, 'the first slider is whole inside the sheet').toBeLessThanOrEqual(sheet.y + sheet.height);
  // The photo keeps the rest of the screen: the sheet is at most 52% of the height.
  expect(sheet.height).toBeLessThanOrEqual(844 * 0.52 + 1);

  // The colour-vision switch is a project setting on a phone: it lives in the grid menu, not on each photo.
  await expect(studio.getByTestId('cvd-toggle')).toBeHidden();
});

test('phone Photo styles: the sheet stays at 44% and says nothing about hovering', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Phone layout only.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?v2&stub=1');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: 'Cairngorms Pinewood Stags', exact: true }).click();
  await studio.getByRole('navigation', { name: 'Mobile studio tools' }).getByRole('button', { name: 'Adjust' }).tap();
  await studio.getByRole('tab', { name: 'Photo styles' }).tap();
  const sheet = (await studio.getByTestId('mobile-sheet-handle').locator('xpath=..').boundingBox())!;
  expect(sheet.height).toBeLessThanOrEqual(844 * 0.44 + 1);
  await expect(studio.getByText(/^Hover over a style/)).toBeHidden();
});

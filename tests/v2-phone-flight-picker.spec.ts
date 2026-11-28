import { expect, test } from '@playwright/test';

// Phone Flight sheet: the sheet is short and already named after the mode, so the mode choice is one slim row (44 px
// targets, label kept for screen readers) and the recommendations start straight under it.
test('phone Flight sheet: a slim mode row, then the recommendations', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Phone layout only.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?v2&stub=1');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: 'Cairngorms Pinewood Stags', exact: true }).click();
  await studio.getByRole('button', { name: /Flight/ }).first().click();

  const modes = studio.getByRole('group', { name: 'Flight mode for this project' });
  await expect(modes).toBeVisible();
  const boxes = await Promise.all(['solo', 'copilot', 'autopilot'].map(async (mode) => (await modes.getByTestId(`flight-mode-${mode}`).boundingBox())!));
  for (const box of boxes) {
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeLessThanOrEqual(48);
    expect(Math.abs(box.y - boxes[0].y)).toBeLessThan(1); // one row
  }
  // The recommendations begin close under the row: no card padding or visible label in between.
  const group = (await modes.boundingBox())!;
  const recommendations = (await studio.getByTestId('copilot-recommendations').boundingBox())!;
  expect(group.height).toBeLessThanOrEqual(52);
  expect(recommendations.y - (group.y + group.height)).toBeLessThanOrEqual(24);

  // The choice still works and is still announced.
  await modes.getByText('Auto-pilot', { exact: true }).click();
  await expect(modes.getByRole('radio', { name: 'Auto-pilot' })).toBeChecked();
  await expect(studio.getByRole('heading', { name: 'Auto-pilot', exact: true }).first()).toBeVisible();
});

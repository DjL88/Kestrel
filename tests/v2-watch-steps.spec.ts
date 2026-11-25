import { expect, test } from '@playwright/test';

// Watch: a Co-pilot suggestion played one step at a time (Guided Auto, owner checklist). Each step says what changes in
// plain words and previews it on the photo; nothing is applied until Apply, and stopping leaves the photo as it was.
test('?v2 watch a suggestion step by step: working order, preview only, keyboard, and stop leaves the photo as it was', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Co-pilot opens from the desktop tool rail.');
  await page.goto('/?v2&stub=1');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: /Open studio/ }).first().click();
  await studio.getByRole('button', { name: /^Co-pilot/ }).first().click();

  const photo = studio.getByTestId('canvas-frame').locator('img').first();
  const filter = () => photo.evaluate((img) => getComputedStyle(img).filter);
  const before = await filter();

  await studio.getByTestId('watch-start').first().click();
  const watch = studio.getByTestId('watch-steps');
  await expect(watch).toBeVisible();
  // The sample suggestion changes warmth, highlights, shadows and vibrance: white balance comes first.
  await expect(watch.getByTestId('watch-step-count')).toHaveText('Step 1 of 4');
  // From the photo's real current value to the suggestion's.
  await expect(watch.getByTestId('watch-step-value')).toHaveText(/^Temperature: -?\d+(\.\d+)? → 10$/);
  await expect(watch).toContainText('First the colour of the light');
  await expect.poll(filter).not.toBe(before);

  // Focus starts on Next, so the arrow keys step straight away.
  await page.keyboard.press('ArrowRight');
  await expect(watch.getByTestId('watch-step-count')).toHaveText('Step 2 of 4');
  await expect(watch.getByTestId('watch-step-value')).toContainText('Highlights');
  await page.keyboard.press('ArrowLeft');
  await expect(watch.getByTestId('watch-step-count')).toHaveText('Step 1 of 4');

  await watch.getByRole('button', { name: 'Skip to the end' }).click();
  await expect(watch.getByTestId('watch-step-count')).toHaveText('Step 4 of 4');
  await expect(watch.getByTestId('watch-done')).toBeVisible();
  await expect(watch.getByRole('button', { name: 'Watch again' })).toBeFocused();

  // Nothing was applied: Escape stops, and the photo looks exactly as it did.
  await page.keyboard.press('Escape');
  await expect(watch).toHaveCount(0);
  await expect.poll(filter).toBe(before);
  await expect(studio.getByTestId('watch-start').first()).toBeVisible();
});

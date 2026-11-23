import { expect, test } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'the V2 phone layout is checked in a later slice');
});

test('?v2 automated runs never see the splash', async ({ page }) => {
  await page.goto('/?v2&stub=1');
  await expect(page.locator('.inflight-v2')).toBeVisible();
  await expect(page.getByTestId('splash')).toHaveCount(0);
});

test('?v2 plays the launch animation, then leaves the workspace ready', async ({ page }) => {
  await page.goto('/?v2&stub=1&splash=1');
  const splash = page.getByTestId('splash');
  await expect(splash).toBeVisible();
  await expect(splash.getByTestId('splash-animation')).toHaveAttribute('data-played', 'true');
  await expect(splash).toHaveCount(0, { timeout: 8000 });
  await expect(page.locator('.inflight-v2')).toBeVisible();
});

test('?v2 a key press skips the splash and does not trigger a shortcut underneath', async ({ page }) => {
  await page.goto('/?v2&stub=1&autostart=1&splash=1');
  await expect(page.getByTestId('splash')).toBeVisible();
  await page.keyboard.press('g');
  await expect(page.getByTestId('splash')).toHaveCount(0, { timeout: 2000 });
  // G opens the grid view; the key that skipped the splash must not have done so.
  await expect(page.getByLabel('All photos grid view')).toHaveCount(0);
  // And the shortcut is live once the splash is gone (so the check above is not vacuous).
  await page.keyboard.press('g');
  await expect(page.getByLabel('All photos grid view')).toBeVisible();
});

test('?v2 with reduced motion shows the still logo and leaves quickly', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?v2&stub=1&splash=1');
  const splash = page.getByTestId('splash');
  await expect(splash.getByTestId('brand-logo-stacked')).toBeVisible();
  await expect(splash.getByTestId('splash-animation')).toHaveCount(0);
  await expect(splash).toHaveCount(0, { timeout: 4000 });
});

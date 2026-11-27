import { expect, test } from '@playwright/test';

// Owner, Windows test (26 Nov): another photo opened at the last photo's 214%; it should fit the screen. And the button
// beside the zoom taken for "fit" made the window full screen: Fit now has its own button with a word on it.
test('?v2 another photo opens fitted to the screen, and Fit has its own labelled button', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The zoom bar is the same everywhere; checked once.');
  await page.goto('/?v2&stub=1');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: /Open studio/ }).first().click();

  const fit = studio.getByTestId('zoom-fit');
  await expect(fit).toHaveText('Fit');
  await expect(fit).toHaveAttribute('aria-pressed', 'true');
  await studio.getByRole('button', { name: 'Zoom in' }).click();
  await expect(fit).toHaveAttribute('aria-pressed', 'false');

  // Another photo opens fitted.
  const photos = studio.getByRole('listbox', { name: 'Project photographs' }).getByRole('option');
  await photos.nth(1).getByRole('button').nth(1).click();
  await expect(photos.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(fit).toHaveAttribute('aria-pressed', 'true');

  // Fit brings a zoomed photo back to the screen.
  await studio.getByRole('button', { name: 'Zoom in' }).click();
  await expect(fit).toHaveAttribute('aria-pressed', 'false');
  await fit.click();
  await expect(fit).toHaveAttribute('aria-pressed', 'true');

  // The full-screen button is the one that says so.
  await expect(studio.getByRole('button', { name: 'Enter full screen' })).toBeVisible();
});

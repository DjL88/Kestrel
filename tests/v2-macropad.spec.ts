import { openV2Settings } from './helpers';
import { expect, test } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'the V2 phone layout is checked in a later slice');
});

test('?v2 a macro pad key flags the photo and the dial steps through the photos', async ({ page }) => {
  await page.goto('/?v2&stub=1&autostart=1');
  const root = page.locator('.inflight-v2');
  const options = root.getByRole('option');
  await expect(options.first()).toBeVisible();
  expect(await options.count()).toBeGreaterThan(1);
  const selected = () => options.evaluateAll((els) => els.findIndex((el) => el.getAttribute('aria-selected') === 'true'));
  const start = await selected();
  // The dial turned right sends ArrowRight in the starting set-up: next photo.
  await page.keyboard.press('ArrowRight');
  await expect.poll(selected).toBe(start + 1 >= (await options.count()) ? start : start + 1);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(selected).toBe(Math.max(0, start));
  // Key 1 (K) flags; pressing again unflags.
  const flagged = () => root.getByRole('button', { name: /^Unflag / }).count();
  const before = await flagged();
  await page.keyboard.press('k');
  await expect.poll(flagged).not.toBe(before);
});

test('?v2 Settings > Keyboard shows the last pad key, learns a new key and reports a clash', async ({ page }) => {
  await page.goto('/?v2&stub=1&autostart=1');
  const root = page.locator('.inflight-v2');
  await openV2Settings(page);
  await root.getByRole('tab', { name: 'Keyboard' }).or(root.getByRole('button', { name: 'Keyboard' })).first().click();
  await page.keyboard.press('k');
  await expect(root.getByTestId('pad-last-key')).toContainText('Key 1');
  // Teach Key 2 the F key (which is Flag on the keyboard): both are reported, neither runs.
  await root.getByRole('button', { name: 'Learn the key for Key 2' }).click();
  await page.keyboard.press('f');
  await expect(root.getByRole('alert').filter({ hasText: 'Key 2' })).toContainText('Clash');
  await root.getByRole('button', { name: 'Reset pad to the starting set-up' }).click();
  await expect(root.getByRole('alert')).toHaveCount(0);
});

test('?v2 Settings > Keyboard: the dial press can be learnt, and F13 to F21 moves the pad off keyboard keys', async ({ page }) => {
  await page.goto('/?v2&stub=1&autostart=1');
  const root = page.locator('.inflight-v2');
  // Playwright's keyboard has no F13 and up, so the pad's key is sent as the browser would deliver it.
  const padSends = (code: string) => page.evaluate((c) => document.body.dispatchEvent(new KeyboardEvent('keydown', { code: c, key: c, bubbles: true })), code);
  await openV2Settings(page);
  await root.getByRole('tab', { name: 'Keyboard' }).or(root.getByRole('button', { name: 'Keyboard' })).first().click();
  // The dial press starts idle; learning a key for it is reported like any slot.
  await root.getByRole('button', { name: 'Learn the key for Dial pressed' }).click();
  await padSends('F21');
  await padSends('F21');
  await expect(root.getByTestId('pad-last-key')).toContainText('Dial pressed');
  // F13 to F21: Key 1 now sends F13, and the button says it's already done.
  const useFKeys = root.getByRole('button', { name: 'Use F13 to F21, keys no keyboard has' });
  await useFKeys.click();
  await expect(useFKeys).toBeDisabled();
  await padSends('F13');
  await expect(root.getByTestId('pad-last-key')).toContainText('Key 1');
  await expect(root.getByRole('alert')).toHaveCount(0);
  await root.getByRole('button', { name: 'Reset pad to the starting set-up' }).click();
  await expect(useFKeys).toBeEnabled();
});

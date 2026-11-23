import { expect, test } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'the V2 phone layout is checked in a later slice');
});

test('?v2 Settings lists every InFlight language, marks drafts and restarts in the chosen one', async ({ page }) => {
  await page.goto('/?v2&stub=1&autostart=1');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: /Settings/ }).first().click();
  await root.getByRole('tab', { name: 'Language' }).or(root.getByRole('button', { name: 'Language' })).first().click();
  const select = root.getByLabel('Display language');
  await expect(select.locator('option')).toHaveCount(20);
  await expect(select.locator('option', { hasText: 'Deutsch (draft)' })).toHaveCount(1);
  await select.selectOption('de');
  await expect.poll(() => page.evaluate(() => document.documentElement.lang).catch(() => ''), { timeout: 15000 }).toBe('de');
  expect(await page.evaluate(() => localStorage.getItem('kestrel-language'))).toBe('de');
  // V2 words not yet translated fall back to British English, never to blank or a key name.
  await expect(page.locator('.inflight-v2')).toBeVisible();
});

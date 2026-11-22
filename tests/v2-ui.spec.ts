import { expect, test } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'the V2 phone layout is checked in a later slice');
});

test('V2 is off by default and the current app is untouched', async ({ page }) => {
  await page.goto('/?v2=0');
  await expect(page.locator('.inflight-v2')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
});

test('?v2 shows the V2 hub, opens a project and shows the editor shell on the stub store', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await expect(root).toBeVisible();
  // Scoped tokens: the current app's styles are not changed.
  expect(await root.evaluate((el) => getComputedStyle(el).getPropertyValue('--brand-accent').trim())).toBe('#e8743c');
  expect(await page.evaluate(() => document.documentElement.dataset.theme ?? '')).not.toBe('light');
  await root.getByRole('button', { name: /Scottish Highlands/ }).first().click();
  const compare = root.getByRole('button', { name: 'Compare', exact: true });
  await expect(compare).toHaveAttribute('aria-pressed', 'false');
  await compare.click();
  await expect(compare).toHaveAttribute('aria-pressed', 'true');
  await expect(root.getByText('Before', { exact: true }).first()).toBeVisible();
});

test('leaving V2 with ?v2=0 restores the current app', async ({ page }) => {
  await page.goto('/?v2');
  await expect(page.locator('.inflight-v2')).toBeVisible();
  await page.goto('/?v2=0');
  await expect(page.locator('.inflight-v2')).toHaveCount(0);
});

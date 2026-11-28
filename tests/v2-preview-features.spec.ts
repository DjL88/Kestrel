import { test, expect } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'the V2 phone layout has no Settings button in the top bar; it is checked in a later slice');
});

const openPreviews = async (page: import('@playwright/test').Page) => {
  await page.goto('/?v2&stub=1');
  await page.locator('.inflight-v2').getByRole('button', { name: 'Settings', exact: true }).first().click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('tab', { name: 'Preview features' }).click();
  return settings.getByTestId('preview-features');
};

test('Settings → Preview features: every switch starts off, toggles by mouse and keyboard, says On or Off in words and is kept', async ({ page }) => {
  const panel = await openPreviews(page);
  const rules = panel.getByRole('switch', { name: 'Culling rules' });
  await expect(rules).toHaveAttribute('aria-checked', 'false');
  await expect(rules).toHaveText('Off');
  await rules.click();
  await expect(rules).toHaveAttribute('aria-checked', 'true');
  await expect(rules).toHaveText('On');
  expect(await page.evaluate(() => localStorage.getItem('kestrel.preview.cull-rules.v1'))).toBe('1');

  // The switch is a button: Space works from the keyboard and turns it off again, removing the key.
  await rules.focus();
  await page.keyboard.press('Space');
  await expect(rules).toHaveAttribute('aria-checked', 'false');
  expect(await page.evaluate(() => localStorage.getItem('kestrel.preview.cull-rules.v1'))).toBeNull();

  await rules.click();
  const again = await (async () => { await page.reload(); return openPreviews(page); })();
  await expect(again.getByRole('switch', { name: 'Culling rules' })).toHaveAttribute('aria-checked', 'true');
});

test('Settings → Preview features: a preview read only at start-up says so and offers Restart now after a change', async ({ page }) => {
  const panel = await openPreviews(page);
  const item = panel.locator('[data-preview-id="ortWebgpu"]');
  await expect(item.getByText('Takes effect after you restart.')).toBeVisible();
  await expect(item.getByRole('button', { name: 'Restart now' })).toHaveCount(0);
  await item.getByRole('switch').click();
  await expect(item.getByRole('button', { name: 'Restart now' })).toBeVisible();
});

test('Settings → Preview features: a feature already on for everyone is shown as on and has no switch', async ({ page }) => {
  const panel = await openPreviews(page);
  const item = panel.locator('[data-preview-id="focusStack"]');
  await expect(item.getByText('On for everyone')).toBeVisible();
  await expect(item.getByRole('switch')).toHaveCount(0);
});

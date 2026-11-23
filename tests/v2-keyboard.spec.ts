import { expect, test } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'the V2 phone layout is checked in a later slice');
});

async function openKeyboardTab(page: import('@playwright/test').Page) {
  await page.goto('/?v2&stub=1&autostart=1');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: /Settings/ }).first().click();
  await root.getByRole('tab', { name: 'Keyboard' }).or(root.getByRole('button', { name: 'Keyboard' })).first().click();
  return root;
}

test('?v2 Settings > Keyboard: change a key, it works and is remembered, a clash is shown in words', async ({ page }) => {
  const root = await openKeyboardTab(page);
  await expect(root.getByText('No clashes.')).toBeVisible();
  // Move the grid view from G to Y.
  await root.getByRole('button', { name: 'Change key for All photos (grid view)' }).click();
  await page.keyboard.press('y');
  await expect(root.getByText('All photos (grid view) (changed)')).toBeVisible();
  // Assign F (flag) to the grid too: the clash is said in words.
  await root.getByRole('button', { name: 'Change key for All photos (grid view)' }).click();
  await page.keyboard.press('f');
  await expect(root.getByRole('alert').first()).toContainText('Clash');
  // Back to Y, close Settings; Y opens the grid, G no longer does.
  await root.getByRole('button', { name: 'Change key for All photos (grid view)' }).click();
  await page.keyboard.press('y');
  await expect(root.getByText('No clashes.')).toBeVisible();
  await page.keyboard.press('Escape');
  await root.getByRole('button', { name: /close settings/i }).first().click().catch(() => undefined);
  await page.keyboard.press('g');
  await expect(page.getByLabel('All photos grid view')).toHaveCount(0);
  await page.keyboard.press('y');
  await expect(page.getByLabel('All photos grid view')).toBeVisible();
  // The choice is saved on this device.
  await page.reload();
  expect(await page.evaluate(() => localStorage.getItem('inflight-v2-keymap'))).toContain('KeyY');
});

test('?v2 Settings > Keyboard: Esc cancels a capture and the Lightroom key set flags with P', async ({ page }) => {
  const root = await openKeyboardTab(page);
  await root.getByRole('button', { name: 'Change key for Flag or unflag selected photos' }).click();
  await page.keyboard.press('Escape');
  await expect(root.getByText('Flag or unflag selected photos (changed)')).toHaveCount(0);
  await root.getByLabel('Key set').selectOption('lightroom');
  await expect(root.locator('kbd', { hasText: /^P$/ })).toBeVisible();
});

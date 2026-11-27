import { expect, test } from '@playwright/test';
import { openV2Settings } from './helpers';

// Dave, 27 Nov: Settings › Export formats lets people show or hide the ready-made formats; hidden ones stay out of the
// Formats panel (and so the export picker), on this device, and come back with one click.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Settings opens from the desktop rail; the rule is the same everywhere.');
});

test('?v2 a format hidden in Settings leaves the Formats panel, and Show all brings it back', async ({ page }) => {
  await page.goto('/?v2&stub=1&autostart=1');
  const root = page.locator('.inflight-v2');
  const formats = async () => {
    await root.getByRole('button', { name: 'Formats', exact: true }).first().click();
    return root.getByRole('button', { name: 'Include Instagram / TikTok Story', exact: true });
  };
  await expect(await formats()).toHaveCount(1);

  await openV2Settings(page);
  await page.getByRole('tab', { name: 'Export formats' }).or(page.getByRole('button', { name: 'Export formats' })).first().click();
  const section = page.getByTestId('settings-export-formats');
  await expect(section.getByTestId('settings-format-orig-3x2')).toHaveCount(0);
  await section.getByRole('button', { name: 'Hide social formats' }).click();
  await expect(section.getByTestId('settings-format-ig-story')).not.toBeChecked();
  await page.getByRole('button', { name: 'Close settings' }).click();
  // The Original and formats already in use stay; the hidden Story does not show.
  const story = await formats();
  await expect(story).toHaveCount(0);
  await expect(root.getByTestId('format-row-orig-3x2')).toBeVisible();

  await openV2Settings(page);
  await page.getByRole('tab', { name: 'Export formats' }).or(page.getByRole('button', { name: 'Export formats' })).first().click();
  await page.getByTestId('settings-export-formats').getByRole('button', { name: 'Show all' }).click();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(await formats()).toHaveCount(1);
});

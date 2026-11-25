import { openV2Settings } from './helpers';
import { expect, test, type Page } from '@playwright/test';

// Neurodivergent accessibility (owner R&D item 2): dialogs you can leave with Escape, messages that wait to be read,
// and Calm View as a preset over separate switches, calmer by default.

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop tool rail and keyboard.');
});

async function openEditor(page: Page) {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Comfort check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 240; c.height = 160;
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#556677'; ctx.fillRect(0, 0, 240, 160);
    return c.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'comfort-1.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  return root;
}

test('?v2 Settings takes focus, keeps Tab inside, closes with Escape and gives focus back', async ({ page }) => {
  await page.goto('/?v2');
  const opener = page.locator('.inflight-v2').getByRole('button', { name: 'Settings', exact: true }).first();
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  for (let i = 0; i < 60; i++) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('?v2 is calmer by default, and Calm View switches its parts together while slider numbers stay separate', async ({ page }) => {
  const root = await openEditor(page);
  await expect(root).toHaveAttribute('data-v2-motion', 'calm');

  await openV2Settings(page);
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  const preset = dialog.getByRole('switch', { name: 'Calm View' });
  const motion = dialog.getByRole('switch', { name: 'Less movement' });
  const badges = dialog.getByRole('switch', { name: 'Fewer badges' });
  const hints = dialog.getByRole('switch', { name: 'Fewer hints' });
  const numbers = dialog.getByRole('switch', { name: 'Hide slider numbers' });
  await expect(motion).toHaveAttribute('aria-checked', 'true');
  await expect(badges).toHaveAttribute('aria-checked', 'true');
  await expect(hints).toHaveAttribute('aria-checked', 'false');
  await expect(numbers).toHaveAttribute('aria-checked', 'false');
  await expect(preset).toHaveAttribute('aria-checked', 'false');

  await preset.click();
  await expect(preset).toHaveAttribute('aria-checked', 'true');
  await expect(hints).toHaveAttribute('aria-checked', 'true');
  await expect(numbers).toHaveAttribute('aria-checked', 'false');

  await preset.click();
  for (const part of [motion, badges, hints]) await expect(part).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');
  await expect(root).not.toHaveAttribute('data-v2-motion', 'calm');
});

test('?v2 a message stays long enough to read, even in Calm View, and can be dismissed', async ({ page }) => {
  const root = await openEditor(page);
  await openV2Settings(page);
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('switch', { name: 'Calm View' }).click();
  await page.keyboard.press('Escape');

  await root.getByRole('button', { name: 'Masks', exact: true }).first().click();
  await root.getByRole('button', { name: /Oval area/ }).click();
  const message = root.getByRole('status').filter({ hasText: 'Added an adjustable Oval area mask' });
  await expect(message).toBeVisible();
  await page.waitForTimeout(4000); // the old message had gone after 3.2 seconds
  await expect(message).toBeVisible();
  await message.getByRole('button', { name: 'Dismiss message' }).click();
  await expect(message).toHaveCount(0);
});

test('?v2 text size, the easy-to-read font and roomy spacing change the interface but never the photo\'s overlay text', async ({ page }) => {
  await page.goto('/?v2&stub=1&autostart=1');
  const root = page.locator('.inflight-v2');
  const railLabel = root.getByRole('button', { name: 'Overlays', exact: true }).first();
  const sizeOf = () => railLabel.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const before = await sizeOf();

  await railLabel.click();
  await root.locator('div').filter({ hasText: /^Show text overlay on this photo/ }).getByRole('switch').first().click();
  const overlayText = root.locator('[data-overlay="text"] p').first();
  await expect(overlayText).toBeVisible();
  const overlayFont = await overlayText.evaluate((el) => getComputedStyle(el).fontFamily);

  await openV2Settings(page);
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: '150%' }).click();
  await dialog.getByRole('button', { name: /Easy to read/ }).click();
  await dialog.getByRole('button', { name: /Roomy/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-text-size', '150');
  await page.keyboard.press('Escape');

  expect(await sizeOf()).toBeCloseTo(before * 1.5, 0);
  expect(await railLabel.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Atkinson Hyperlegible');
  expect(await overlayText.evaluate((el) => getComputedStyle(el).fontFamily)).toBe(overlayFont);
  // Line height scales with the overlay's own size, so compare it as a share of the font size.
  const ratio = (await overlayText.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight) / parseFloat(getComputedStyle(el).fontSize)));
  expect(ratio).toBeLessThan(1.5); // roomy would be 1.65; leading-snug is 1.375
});

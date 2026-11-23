import { expect, test } from '@playwright/test';

test('All Formats: Shift range, Cmd/Ctrl toggle and blank-space clear control the fixed toolbar', async ({ page }) => {
  await page.goto('/?v2&stub=1&autostart=1');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: /All formats/ }).click();
  const original = root.getByTestId('artboard-orig-3x2').getByRole('button', { name: /Select/ });
  const wide = root.getByTestId('artboard-yt-wide').getByRole('button', { name: /Select/ });
  const toolbar = root.getByTestId('selected-format-toolbar');

  await original.click();
  await expect(root.getByTestId('selected-format-count')).toHaveText('1 selected');
  await wide.click({ modifiers: ['Shift'] });
  await expect(root.getByTestId('selected-format-count')).toHaveText('3 selected');
  await expect(root.getByTestId('artboard-ig-portrait').getByRole('button', { name: /Select/ })).toHaveAttribute('aria-pressed', 'true');

  await wide.click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
  await expect(root.getByTestId('selected-format-count')).toHaveText('2 selected');
  await expect(wide).toHaveAttribute('aria-pressed', 'false');

  await root.getByTestId('all-formats-board').click({ position: { x: 3, y: 3 } });
  await expect(toolbar).toHaveCount(0);
  await root.getByRole('button', { name: 'Select all' }).click();
  await expect(root.getByTestId('selected-format-count')).toHaveText('3 selected');
});

test('All Formats: dragging a selected tile moves the selected group together', async ({ page }) => {
  await page.goto('/?v2&stub=1&autostart=1');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: /All formats/ }).click();
  await root.getByRole('button', { name: 'Select all' }).click();

  const one = root.getByTestId('artboard-orig-3x2');
  const two = root.getByTestId('artboard-ig-portrait');
  const firstBefore = await one.boundingBox();
  const secondBefore = await two.boundingBox();
  const header = await one.locator('.cursor-grab').first().boundingBox();
  expect(firstBefore && secondBefore && header).toBeTruthy();
  if (!firstBefore || !secondBefore || !header) return;

  await page.mouse.move(header.x + header.width / 2, header.y + header.height / 2);
  await page.mouse.down();
  await page.mouse.move(header.x + header.width / 2 + 60, header.y + header.height / 2 + 35, { steps: 8 });
  await page.mouse.up();
  const firstAfter = await one.boundingBox();
  const secondAfter = await two.boundingBox();
  expect(firstAfter && secondAfter).toBeTruthy();
  if (!firstAfter || !secondAfter) return;

  const shiftOne = firstAfter.x - firstBefore.x;
  const shiftTwo = secondAfter.x - secondBefore.x;
  expect(shiftOne).toBeGreaterThan(15);
  expect(Math.abs(shiftOne - shiftTwo)).toBeLessThan(5);
  await root.getByRole('button', { name: 'Tidy board' }).click();
  const firstTidy = await one.boundingBox();
  expect(firstTidy).toBeTruthy();
  if (firstTidy) expect(Math.abs(firstTidy.x - firstBefore.x)).toBeLessThan(5);
});
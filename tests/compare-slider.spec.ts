import { expect, test } from '@playwright/test';

test('the before/after slider follows a drag', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles({
    name: 'f.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
  });
  await page.getByRole('tab', { name: 'Crop' }).waitFor();
  await page.getByRole('button', { name: 'Before / After' }).click();
  const slider = page.getByRole('slider', { name: 'Comparison wipe' }).first();
  await expect(slider).toBeVisible();
  const start = Number(await slider.getAttribute('aria-valuenow'));
  const box = (await slider.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y, { steps: 6 });
  await page.mouse.up();
  expect(Number(await slider.getAttribute('aria-valuenow')), 'the divider moved').toBeGreaterThan(start + 5);
});

test('the before/after slider follows a finger', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'touch');
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles({
    name: 'f.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
  });
  await page.getByRole('tab', { name: 'Crop' }).waitFor();
  await page.getByRole('button', { name: 'Before / After' }).click();
  const slider = page.getByRole('slider', { name: 'Comparison wipe' }).first();
  await expect(slider).toBeVisible();
  const start = Number(await slider.getAttribute('aria-valuenow'));
  const box = (await slider.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= 6; step += 1) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + step * 10, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(Number(await slider.getAttribute('aria-valuenow')), 'the divider moved with a finger').toBeGreaterThan(start + 5);
});

import { expect, test } from '@playwright/test';

test('real oval and gradient mask coverage follows selection, hide and panel dismissal', async ({ page, isMobile }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Mask coverage check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const image = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 480; c.height = 320;
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#606060'; ctx.fillRect(0, 0, 480, 320);
    return c.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'coverage.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') }]);
  const frame = root.getByTestId('canvas-frame');
  await expect(frame.locator('img').first()).toBeVisible({ timeout: 30000 });
  // A phone has no rail: Masks sits in the bottom bar's More tools (as in verified-asset-v2-adaptive).
  if (isMobile) await root.getByRole('navigation', { name: 'Mobile studio tools' }).getByRole('button', { name: 'More' }).click();
  await root.getByRole('button', { name: 'Masks', exact: true }).first().click();
  await root.getByRole('button', { name: 'Oval area', exact: true }).click();
  const guide = frame.getByTestId('mask-coverage-guide');
  await expect(guide).toBeVisible();
  const first = await guide.getAttribute('src');
  await root.getByRole('button', { name: 'Hide Round area' }).click();
  await expect(guide).toHaveCount(0);
  await root.getByRole('button', { name: 'Show Round area' }).click();
  await expect(guide).toBeVisible();
  await root.getByRole('button', { name: 'Gradient', exact: true }).click();
  await expect.poll(() => guide.getAttribute('src')).not.toBe(first);
  await root.getByRole('button', { name: /Gradient.*no adjustments/ }).click();
  await expect(guide).toHaveCount(0);
});

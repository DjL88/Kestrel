import { expect, test } from '@playwright/test';

/**
 * Owner checklist: masks combine as a set. Two oval masks: the first takes the second as a part, which can be set to
 * Add, Subtract or Intersect and removed again, and the layer reads Combined while it has one. The alpha each mode gives,
 * several parts in order, is measured in maskOps.test.ts.
 */
test('a mask takes another mask as a part (Add, Subtract or Intersect), and the part can be removed again', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'The Masks panel is reached from the desktop rail here; phone layout is the UI Optimisation lane.');
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Mask parts');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const image = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 600; c.height = 400;
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#505050'; ctx.fillRect(0, 0, 600, 400);
    return c.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'parts.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') }]);
  await expect(root.getByTestId('canvas-frame').locator('img').first()).toBeVisible({ timeout: 30000 });

  await root.getByRole('button', { name: 'Masks', exact: true }).first().click();
  await root.getByRole('button', { name: 'Oval area', exact: true }).click();
  await root.getByRole('button', { name: 'Oval area', exact: true }).click();

  // Open the first oval's layer.
  const first = root.locator('button[aria-expanded]').filter({ hasText: 'Round area' }).first();
  if ((await first.getAttribute('aria-expanded')) !== 'true') await first.click();
  await expect(first).toHaveAttribute('aria-expanded', 'true');

  const parts = root.getByTestId('v2-mask-parts');
  await expect(parts).toBeVisible();
  await parts.getByTestId('v2-mask-add-part').click();
  const mode = parts.getByRole('combobox', { name: /1: How it combines/ });
  await expect(mode).toHaveValue('intersect');
  await expect(first).toContainText('Combined');

  await mode.selectOption('add');
  await expect(mode).toHaveValue('add');
  await mode.selectOption('subtract');
  await expect(mode).toHaveValue('subtract');
  await expect(parts.getByRole('combobox', { name: /1: Which mask/ })).toHaveValue(/.+/);

  // The part can be removed again, and the mask is no longer combined.
  await parts.getByRole('button', { name: /1: Remove this part/ }).click();
  await expect(parts.getByRole('combobox', { name: /1: How it combines/ })).toHaveCount(0);
  await expect(first).not.toContainText('Combined');
});

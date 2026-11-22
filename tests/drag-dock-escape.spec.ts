import { expect, test } from '@playwright/test';

test('Escape during a pane drag cancels it: the panel stays floating, back where it was, and does not dock on release', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'Floating panels are deliberately replaced by a bottom sheet on phones.');
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Escape drag test');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#777777'; ctx.fillRect(0, 0, 128, 128);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles({ name: 'esc.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') });
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();

  await page.getByRole('tab', { name: 'Edit', exact: true }).click({ button: 'right' });
  await page.getByTestId('tab-context-menu').getByRole('menuitem', { name: 'Undock Edit' }).click();
  const pane = page.locator('[data-floating-pane]').filter({ hasText: 'Edit' });
  await expect(pane).toBeVisible();
  const before = (await pane.boundingBox())!;
  const handle = pane.locator('[data-pane-drag-handle]');
  const box = (await handle.boundingBox())!;
  const viewport = page.viewportSize()!;

  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(viewport.width / 2, box.y + 40, { steps: 5 });
  await page.mouse.move(viewport.width - 20, box.y + 40, { steps: 8 });
  await expect(page.locator('[data-dock-zone="right"]')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-dock-zone]')).toHaveCount(0);
  await page.mouse.up();

  // Still floating (a docked panel would have closed the pane), and back at its starting rectangle.
  await expect(pane).toHaveCount(1);
  const after = (await pane.boundingBox())!;
  expect(Math.abs(after.x - before.x), 'x restored').toBeLessThan(2);
  expect(Math.abs(after.y - before.y), 'y restored').toBeLessThan(2);
});

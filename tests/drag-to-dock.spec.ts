import { expect, test } from '@playwright/test';

test('dragging an undocked tool panel onto the window edge docks it there', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'Floating panels are deliberately replaced by a bottom sheet on phones.');
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Drag dock test');
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
  await page.getByTestId('local-file-input').setInputFiles({ name: 'dock.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') });
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();

  await page.locator('[data-editor-undock]').click();
  const pane = page.locator('[data-floating-pane]').filter({ hasText: 'Edit' });
  await expect(pane).toBeVisible();
  const handle = pane.locator('[data-pane-drag-handle]');
  const box = (await handle.boundingBox())!;
  const viewport = page.viewportSize()!;
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(viewport.width / 2, box.y + 40, { steps: 5 });
  // Only the panel's own side is offered, labelled in words (not only coloured).
  await expect(page.locator('[data-dock-zone="left"]')).toHaveCount(0);
  await expect(page.locator('[data-dock-zone="right"]')).toHaveText('Dock right');
  // Letting go on the other edge does not dock it.
  await page.mouse.move(20, box.y + 40, { steps: 8 });
  await page.mouse.up();
  await expect(pane).toBeVisible();
  const again = (await handle.boundingBox())!;
  await page.mouse.move(again.x + 60, again.y + again.height / 2);
  await page.mouse.down();
  await page.mouse.move(again.x + 160, again.y + 80, { steps: 6 });
  await page.mouse.move(viewport.width - 20, box.y + 40, { steps: 8 });
  await page.mouse.up();

  await expect(pane).toHaveCount(0);
  await expect(page.locator('[data-dock-zone]')).toHaveCount(0);
  const docked = (await page.locator('[data-tools-panel]').boundingBox())!;
  // Docked on the right, just inside the tools rail.
  expect(docked.x, 'tools panel is docked in the right half').toBeGreaterThan(viewport.width / 2);
  expect(docked.x + docked.width, 'and reaches the right edge').toBeGreaterThan(viewport.width - 80);
});

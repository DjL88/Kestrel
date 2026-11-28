import { expect, test } from '@playwright/test';

/** Split frames: grow to five on the canvas, select and remove one, and resize the shared photograph. */
test('a split format grows to five frames, a selected frame can be removed, and the picture can be resized', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'The canvas add-frame button is a desktop/tablet affordance; phones use the Formats panel.');
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Five frame split');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();

  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1500; canvas.height = 600;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#2f4a63'; ctx.fillRect(0, 0, 1500, 600);
    ctx.fillStyle = '#d07040'; ctx.fillRect(600, 150, 300, 300);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'panorama.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);

  await root.getByTestId('split-menu-button').click();

  await root.getByTestId('split-menu-split').click();
  await expect(root.locator('[data-testid^="split-frame-"][role="button"]')).toHaveCount(2);
  for (const next of [3, 4, 5]) await root.getByRole('button', { name: `Add a frame (${next} frames)` }).click();
  await expect(root.locator('[data-testid^="split-frame-"][role="button"]')).toHaveCount(5);
  await expect(root.getByTestId('split-frame-add')).toHaveCount(0);

  // Select frame 3 and delete it with the keyboard.
  await root.getByTestId('split-frame-2').click();
  await expect(root.getByTestId('split-frame-2')).toHaveAttribute('aria-pressed', 'true');
  await root.getByTestId('split-frame-2').press('Delete');
  await expect(root.locator('[data-testid^="split-frame-"][role="button"]')).toHaveCount(4);

  // Or with the remove button shown on the selected frame.
  await root.getByTestId('split-frame-0').click();
  await root.getByTestId('split-frame-remove').click();
  await expect(root.locator('[data-testid^="split-frame-"][role="button"]')).toHaveCount(3);

  // Double-click shows resize handles round the whole composition; pulling a corner out zooms in.
  await root.getByTestId('split-frame-1').dblclick();
  const handle = root.getByTestId('split-scale-br');
  await expect(handle).toBeVisible();
  // The picture is drawn through the engine surface, so the pan and zoom sit on the element wrapping the image.
  const img = root.getByTestId('split-frame-1').locator('img').first();
  const transformOf = (el: Element) => getComputedStyle(el.closest('[style*="transform"]') ?? el).transform;
  const before = await img.evaluate(transformOf);
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 60, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => img.evaluate(transformOf)).not.toBe(before);

  await page.screenshot({ path: info.outputPath('split-three-resized.png') });
});

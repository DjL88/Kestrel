import { expect, test } from '@playwright/test';

test('V2 three-frame selection updates the real catalogue, board and saved project after reload', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Three frame persistence acceptance');
  await page.getByRole('dialog')
    .getByRole('button', { name: /create|start|new project/i }).last().click();

  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200; canvas.height = 800;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#324c69'; ctx.fillRect(0, 0, 1200, 800);
    ctx.fillStyle = '#cc6840'; ctx.fillRect(490, 250, 200, 350);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{
    name: 'three-frames.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64'),
  }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' })
    .getByRole('option')).toHaveCount(1);

  await root.getByRole('button', { name: 'Formats', exact: true }).first().click();
  const selector = root.getByRole('group', { name: 'Number of continuous frames' });
  await expect(selector.getByRole('button', { name: 'Rejoin into 1 frame' })).toHaveAttribute('aria-pressed', 'true');
  await selector.getByRole('button', { name: '3 frames' }).click();
  await expect(selector.getByRole('button', { name: '3 frames' })).toHaveAttribute('aria-pressed', 'true');

  await root.getByRole('button', { name: /All formats/ }).click();
  const three = root.getByTestId('format-pair-orig-3x2');
  await expect(three.locator('[data-testid^="artboard-orig-3x2-"]')).toHaveCount(3);
  await expect(three.getByText('Original · 3/3')).toBeVisible();

  // A narrow portrait viewport must keep all three frames reachable without
  // squeezing their aspect or clipping the final numbered artboard.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => {
    const frames = await three.locator('[data-testid^="artboard-orig-3x2-"]').all();
    const boxes = await Promise.all(frames.map(frame => frame.boundingBox()));
    const stage = await root.getByTestId('all-formats-board').boundingBox();
    return boxes.length === 3 && boxes.every(box => box && stage &&
      box.x >= stage.x - 1 && box.x + box.width <= stage.x + stage.width + 1);
  }).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });

  await root.getByRole('button', { name: 'Back to projects' }).click();
  await page.reload();
  await root.getByRole('button', { name: /Open studio/ }).first().click();
  await root.getByRole('button', { name: 'Formats', exact: true }).first().click();
  const reopened = root.getByRole('group', { name: 'Number of continuous frames' });
  await expect(reopened.getByRole('button', { name: '3 frames' })).toHaveAttribute('aria-pressed', 'true');

  await reopened.getByRole('button', { name: '2 frames' }).click();
  await expect(reopened.getByRole('button', { name: '2 frames' })).toHaveAttribute('aria-pressed', 'true');
  // This is a real Undo step, not just a reversible toggle: Ctrl+Z restores
  // the prior persisted three-frame state without touching the original file.
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect(reopened.getByRole('button', { name: '3 frames' })).toHaveAttribute('aria-pressed', 'true');
  await reopened.getByRole('button', { name: 'Rejoin into 1 frame' }).click();
  await expect(reopened.getByRole('button', { name: 'Rejoin into 1 frame' })).toHaveAttribute('aria-pressed', 'true');
});

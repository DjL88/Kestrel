import { expect, test } from '@playwright/test';

// Keep failed model requests observable, rather than letting the service worker
// serve a previously precached ONNX file behind the Playwright network route.
test.use({ serviceWorkers: 'block' });

/** A corrupt/unavailable bundled ONNX file must never block a whole shoot. */
test('subject model fails once, then culling continues conservatively without retry storms', async ({ page }) => {
  test.skip(test.info().project.name === 'phone', 'desktop workspace control scenario');
  test.setTimeout(90_000);
  let modelRequests = 0;
  await page.route(/yolox_tiny.*\.onnx(?:\?|$)/i, async (route) => {
    modelRequests += 1;
    await route.abort('failed');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Model failure fallback');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();

  const photos = await page.evaluate(() => Array.from({ length: 3 }, (_, frame) => {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 384;
    const ctx = canvas.getContext('2d')!;
    for (let y = 0; y < 384; y += 8) {
      for (let x = 0; x < 512; x += 8) {
        ctx.fillStyle = ((x / 8 + y / 8 + frame) % 2 === 0) ? '#252525' : '#d8d8d8';
        ctx.fillRect(x, y, 8, 8);
      }
    }
    ctx.fillStyle = ['#e84c36', '#5f8eaf', '#e9c050'][frame];
    ctx.fillRect(frame * 40 + 20, 60, 75, 90);
    return canvas.toDataURL('image/png').split(',')[1];
  }));

  await page.getByTestId('local-file-input').setInputFiles(photos.map((png, index) => ({
    name: 'model-fails-' + (index + 1) + '.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  })));
  await expect(page.getByRole('navigation', { name: 'Photo collections' })
    .getByRole('button', { name: 'To review 3' })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Workspace options', exact: true }).click();
  await page.locator('#workspace-options').getByRole('button', { name: /Auto-cull/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Auto-cull' });
  await dialog.getByRole('button', { name: /^Scan/ }).click();

  await expect(dialog.getByRole('status').filter({
    hasText: /Subject detection could not run on this device/,
  })).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByRole('region', { name: 'Auto-cull summary' })).toBeVisible({ timeout: 60_000 });
  expect(modelRequests).toBe(1); // no repeated model initialisation for each photo
  await expect(dialog.getByRole('region', { name: 'Auto-cull summary' })).toContainText('0 suggested keepers');
  await dialog.getByRole('button', { name: 'Close auto-cull' }).click();

  // A failed detector cannot make a texture-only photo into a high-confidence keeper.
  const nav = page.getByRole('navigation', { name: 'Photo collections' });
  await expect(nav.getByRole('button', { name: 'Keepers 0' })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'To review 3' })).toBeVisible();
});

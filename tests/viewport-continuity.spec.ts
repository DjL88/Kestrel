import { expect, test } from '@playwright/test';

// A source-to-screen regression: changing Review ⇄ Edit must keep the selected
// photo's camera (zoom and pan), rather than reinitialise a separate viewer.
test.skip(({ viewport }) => (viewport?.width ?? 1280) < 768, 'desktop layout; mobile uses the compact bottom sheet');

test('zoom and pan survive switching from single-photo review to editing and back', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');

  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200; canvas.height = 800;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#64748b'; c.fillRect(0, 0, 1200, 800);
    c.fillStyle = '#e2e8f0'; c.fillRect(260, 180, 450, 320);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Shared view');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles({
    name: 'same-photo.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64'),
  });
  await expect(page.getByRole('navigation', { name: 'Photo collections' })
    .getByRole('button', { name: 'To review 1' })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Workspace options', exact: true }).click();
  await page.getByRole('combobox', { name: 'View', exact: true }).selectOption('loupe');
  await page.keyboard.press('Escape');

  const reviewControls = page.getByRole('group', { name: 'Single photo controls' });
  await expect(reviewControls).toBeVisible();
  const stage = page.getByLabel('Photo canvas');
  const transform = stage.locator('[style*="scale("]').first();
  const zoom = reviewControls.getByRole('group', { name: 'Zoom' });
  await zoom.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(async () => transform.getAttribute('style')).toMatch(/scale\(1\.[0-9]+\)/);

  // Drag on the zoomed photo; mode changes must retain the same pan as well as zoom.
  const bounds = await stage.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width / 2 + 45, bounds!.y + bounds!.height / 2 + 28, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => transform.getAttribute('style')).toMatch(/translate\\([^)]*[1-9][0-9]*px/);

  const before = await transform.getAttribute('style');
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  const editor = page.getByLabel('Photo canvas');
  await expect(editor).toBeVisible({ timeout: 30_000 });
  const editorTransform = editor.locator('[style*="scale("]').first();
  await expect.poll(async () => editorTransform.getAttribute('style')).toContain('scale(');
  const editedStyle = await editorTransform.getAttribute('style');
  expect(editedStyle).toBe(before);

  await page.getByRole('button', { name: 'Back', exact: true }).first().click();
  await expect(reviewControls).toBeVisible({ timeout: 30_000 });
  const after = await page.getByLabel('Photo canvas').locator('[style*="scale("]').first().getAttribute('style');
  expect(after).toBe(before);
});

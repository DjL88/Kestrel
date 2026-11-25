import { expect, test } from '@playwright/test';

/**
 * Owner test (25 Nov): the mask overlay hid the edit. A selected mask now shows as an outline by default (a line round
 * where it applies, said in words in the label), the hatched area is one press away, and while a slider moves the
 * overlay steps aside for a moment so the change itself can be seen, then comes back.
 */
test('the mask overlay is an outline by default, can show as a hatched area, and steps aside while a slider moves', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'The Masks panel is reached from the desktop rail here; the phone layout is the UI Optimisation lane.');
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Mask outline default');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const image = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 600; c.height = 400;
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#505050'; ctx.fillRect(0, 0, 600, 400);
    return c.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'outline.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') }]);
  const frame = root.getByTestId('canvas-frame');
  await expect(frame.locator('img').first()).toBeVisible({ timeout: 30000 });
  await root.getByRole('button', { name: 'Masks', exact: true }).first().click();
  await root.getByRole('button', { name: 'Oval area', exact: true }).click();

  const guide = frame.getByTestId('mask-coverage-guide');
  const label = root.getByTestId('mask-canvas-label');
  await expect(guide).toHaveAttribute('data-style', 'outline');
  await expect(label).toContainText(/Round area · outline shown/);

  // The hatched area is still there as a choice, and the outline comes back the same way.
  await root.getByTestId('mask-overlay-style').click();
  await expect(guide).toHaveAttribute('data-style', 'fill');
  await expect(label).toContainText(/overlay shown/);
  await root.getByTestId('mask-overlay-style').click();
  await expect(guide).toHaveAttribute('data-style', 'outline');

  // Moving one of the mask's sliders hides the overlay for a moment, says so in words, then shows it again.
  const layer = root.locator('button[aria-expanded]').filter({ hasText: 'Round area' }).first();
  if ((await layer.getAttribute('aria-expanded')) !== 'true') await layer.click();
  await root.getByRole('slider', { name: 'Round area Exposure' }).fill('0.8');
  await expect(guide).toHaveCount(0);
  await expect(label).toContainText(/hidden for a moment so you can see the change/);
  await expect(guide).toHaveAttribute('data-style', 'outline', { timeout: 8000 });
  await expect(label).toContainText(/outline shown/);
});

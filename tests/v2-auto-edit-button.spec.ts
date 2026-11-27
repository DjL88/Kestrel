import { expect, test } from '@playwright/test';

// Dave, 27 Nov (installed build, his own kingfisher RAW): there was no Auto button anywhere, Auto-pilot applied nothing
// and said nothing. One Auto button at the top of Adjust applies Natural Auto in one click, says what it did (or in one
// line why it did nothing), and Undo takes it back. The picture is synthetic: a dim bird on a near-black background
// with a few bright specks, the kind of frame that used to get no edit at all.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The Adjust panel is the same on every screen; checked once.');
});

test('?v2 Auto at the top of Adjust lifts a dim subject on a dark background in one click, says so, and Undo takes it back', async ({ page }) => {
  test.setTimeout(180_000);
  await page.route(/\.(onnx|ort)(\?|$)/, (route) => route.abort());
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Auto button');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const png = await page.evaluate(() => {
    const w = 1200, h = 800;
    const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgb(8, 9, 11)'; ctx.fillRect(0, 0, w, h);
    // The bird: dim blue above, dim orange below, with lit streaks.
    ctx.save(); ctx.beginPath(); ctx.ellipse(w / 2, h / 2, w * 0.16, h * 0.2, 0, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = 'rgb(28, 48, 68)'; ctx.fillRect(0, 0, w, h / 2);
    ctx.fillStyle = 'rgb(72, 45, 22)'; ctx.fillRect(0, h / 2, w, h / 2);
    ctx.fillStyle = 'rgb(96, 100, 104)';
    for (let x = 0; x < w; x += 22) ctx.fillRect(x, 0, 3, h);
    ctx.restore();
    // Splash.
    ctx.fillStyle = 'rgb(215, 222, 228)';
    for (let i = 0; i < 40; i += 1) ctx.fillRect(w * 0.3 + ((i * 37) % (w * 0.4)), h * 0.74 + ((i * 53) % 60), 3, 3);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'dark-bird.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1, { timeout: 30_000 });

  const adjust = root.getByRole('button', { name: 'Adjust', exact: true }).first();
  if ((await adjust.getAttribute('aria-pressed')) !== 'true') await adjust.click();
  const auto = root.getByTestId('auto-edit-button');
  await expect(auto).toHaveText('Auto');
  const status = root.getByTestId('auto-edit-status');

  // Reachable and pressable from the keyboard, and answered at once.
  await auto.focus();
  await page.keyboard.press('Enter');
  await expect(status).not.toHaveAttribute('data-state', 'idle', { timeout: 1000 });
  await expect(status).toHaveAttribute('data-state', 'applied', { timeout: 90_000 });
  await expect(status).toContainText('Auto applied.');
  await expect(status).toContainText(/exposure/i);

  // The edit is real: Exposure is no longer zero.
  await root.getByRole('tab', { name: 'Advanced Edits' }).click();
  const exposure = root.getByRole('slider', { name: 'Exposure' });
  expect(Number(await exposure.inputValue())).toBeGreaterThan(0);

  // Before / After and Undo sit with the result. Undo takes the whole edit back in one step.
  await expect(root.getByTestId('auto-edit-compare')).toBeVisible();
  await root.getByTestId('auto-edit-undo').click();
  await expect.poll(async () => Number(await exposure.inputValue())).toBe(0);
});

import { expect, test } from '@playwright/test';
import { CHECKER_SRGB } from '../src/core/colourChecker';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'advanced controls are checked on the desktop layout');
});

test('matching a colour checker sets the calibration sliders and says how close it got', async ({ page }) => {
  await page.goto('/?v2');
  await page.locator('.inflight-v2').getByRole('button', { name: 'Settings', exact: true }).first().click();
  await page.getByRole('dialog', { name: 'Settings' }).getByTestId('advanced-controls-switch').click();
  await page.keyboard.press('Escape');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Checker');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  // A synthetic chart with muted colours, its patch centres where the dialog's marks start (20–80 % across, 25–75 % down).
  const image = await page.evaluate((chart) => {
    const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 320;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#202020'; ctx.fillRect(0, 0, 480, 320);
    chart.forEach((rgb, i) => {
      const grey = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
      const muted = rgb.map((v) => Math.round(grey + (v - grey) * 0.6));
      ctx.fillStyle = `rgb(${muted.join(',')})`;
      const cx = 96 + (i % 6) * 57.6, cy = 80 + Math.floor(i / 6) * (160 / 3);
      ctx.fillRect(cx - 24, cy - 22, 48, 44);
    });
    return canvas.toDataURL('image/png').split(',')[1];
  }, CHECKER_SRGB.map((rgb) => [...rgb]));
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'checker.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  const advanced = root.getByRole('tab', { name: 'Advanced Edits' });
  if (!(await advanced.isVisible())) await root.getByRole('button', { name: 'Adjust', exact: true }).first().click();
  await advanced.click();
  const calibration = root.getByTestId('calibration');
  await calibration.getByRole('button', { name: 'Match a colour checker…' }).click();
  const dialog = page.getByTestId('v2-colour-checker');
  await expect(dialog.getByRole('button', { name: 'White patch, bottom left' })).toBeVisible();
  // The marks move with the keyboard too.
  await dialog.getByRole('button', { name: 'Black patch, bottom right' }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await dialog.getByRole('button', { name: 'Match colours' }).click();
  await expect(dialog).toHaveCount(0);
  const note = calibration.getByRole('status');
  await expect(note).toContainText('before');
  const [before, after] = (await note.textContent())!.match(/\d+(\.\d+)?/g)!.map(Number);
  expect(after).toBeLessThan(before / 2);
  await expect(calibration.getByRole('radio', { name: /changed/ }).first()).toBeVisible();
});

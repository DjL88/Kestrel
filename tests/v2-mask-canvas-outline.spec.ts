import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';

// Owner report (G7): oval (radial) and gradient (linear) masks did not show on the selected photo's canvas.
// The canvas must draw the shape with handles, offer an overlay that is not a colour-only cue and can be
// toggled from the keyboard, and show the mask's effect the same way the export renders it.

async function openPhoto(page: Page) {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Mask outline check');
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
  // A phone has no rail: Masks sits in the bottom bar's More tools (as in verified-asset-v2-adaptive).
  const phoneTools = root.getByRole('navigation', { name: 'Mobile studio tools' });
  if (await phoneTools.isVisible()) await phoneTools.getByRole('button', { name: 'More' }).click();
  await root.getByRole('button', { name: 'Masks', exact: true }).first().click();
  return { root, frame };
}

/** Mean luminance (0-255) of the image at fractions of its width/height, sampled over a small box. */
async function sample(page: Page, src: string, points: Array<[number, number]>) {
  return page.evaluate(async ({ src, points }) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0);
    return points.map(([fx, fy]) => {
      const x = Math.round(fx * c.width) - 2; const y = Math.round(fy * c.height) - 2;
      const d = ctx.getImageData(x, y, 5, 5).data; let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      return sum / (d.length / 4);
    });
  }, { src, points });
}

test('oval mask: outline with handles, keyboard overlay toggle with a text label, dragging moves the saved shape', async ({ page }) => {
  const { root, frame } = await openPhoto(page);
  await root.getByRole('button', { name: 'Oval area', exact: true }).click();

  const outline = frame.getByTestId('mask-outline');
  await expect(outline).toBeVisible();
  await expect(outline).toHaveAttribute('data-kind', 'radial');
  await expect(frame.getByRole('button', { name: 'Move Round area centre' })).toBeVisible();
  await expect(frame.getByRole('button', { name: 'Resize and rotate Round area width' })).toBeVisible();
  await expect(frame.getByRole('button', { name: 'Resize Round area height' })).toBeVisible();

  // The overlay is labelled in words, and by default it is a line round the mask (not a colour-only tint).
  const label = root.getByTestId('mask-canvas-label');
  await expect(label).toContainText('Round area');
  await expect(label).toContainText(/outline shown/i);
  await expect(frame.getByTestId('mask-coverage-guide')).toBeVisible();

  // O hides and shows the overlay; the outline stays so the shape is always visible.
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('o');
  await expect(frame.getByTestId('mask-coverage-guide')).toHaveCount(0);
  await expect(outline).toBeVisible();
  await expect(label).toContainText(/overlay hidden/i);
  await page.keyboard.press('o');
  await expect(frame.getByTestId('mask-coverage-guide')).toBeVisible();

  // Dragging the centre handle to the right moves the saved oval (the panel slider reads it back).
  const centre = frame.getByRole('button', { name: 'Move Round area centre' });
  const box = (await centre.boundingBox())!;
  const frameBox = (await frame.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + frameBox.width * 0.2, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  const cx = root.getByTestId('v2-mask-geometry-cx');
  await expect.poll(async () => Number(await cx.inputValue())).toBeGreaterThan(0.6);

  // Keyboard: the focused handle moves with the arrow keys.
  const before = Number(await cx.inputValue());
  await centre.focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => Number(await cx.inputValue())).toBeLessThan(before);
});

test('gradient mask: outline shows start, middle and end lines with draggable end handles', async ({ page }) => {
  const { root, frame } = await openPhoto(page);
  await root.getByRole('button', { name: 'Gradient', exact: true }).click();
  const outline = frame.getByTestId('mask-outline');
  await expect(outline).toBeVisible();
  await expect(outline).toHaveAttribute('data-kind', 'linear');
  await expect(outline.locator('[data-line]')).toHaveCount(3);
  await expect(frame.getByRole('button', { name: 'Move Gradient start' })).toBeVisible();
  const end = frame.getByRole('button', { name: 'Move Gradient end' });
  await expect(end).toBeVisible();
  const y2 = root.getByTestId('v2-mask-geometry-y2');
  const startY = Number(await y2.inputValue());
  const box = (await end.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 60, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Number(await y2.inputValue())).toBeGreaterThan(startY + 0.05);
});

test('oval mask effect in the canvas preview matches the exported pixels', async ({ page }) => {
  const { root, frame } = await openPhoto(page);
  await root.getByRole('button', { name: 'Oval area', exact: true }).click();
  await root.getByRole('slider', { name: 'Round area Exposure' }).fill('1.5');
  // The base picture is the first image in the frame (the overlay images are separate and never sampled).
  const base = frame.locator('img').first();
  await expect.poll(async () => (await base.getAttribute('src')) ?? '').toMatch(/^blob:/);
  await expect(frame.getByRole('status', { name: 'Refreshing image' })).toHaveCount(0);
  const points: Array<[number, number]> = [[0.5, 0.5], [0.05, 0.05], [0.5 + 0.2, 0.5]];
  const preview = await sample(page, (await base.getAttribute('src'))!, points);
  expect(preview[0] - preview[1]).toBeGreaterThan(10);

  const dialog = page.getByRole('dialog', { name: /export/i });
  await root.getByRole('button', { name: /^Export/ }).first().click();
  await dialog.getByLabel('File format').selectOption('png');
  const downloaded = page.waitForEvent('download');
  await dialog.getByRole('button', { name: /export bundle/i }).click();
  const files = Object.entries(unzipSync(await readFile((await (await downloaded).path())!)));
  expect(files).toHaveLength(1);
  const exported = await sample(page, `data:image/png;base64,${Buffer.from(files[0][1]).toString('base64')}`, points);
  for (let i = 0; i < points.length; i++) expect(Math.abs(exported[i] - preview[i])).toBeLessThan(8);
});

import { expect, test, type Page } from '@playwright/test';
import { openExportAdvanced } from './helpers';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';

// Gap G8: spot healing removes dust, a twig or perch clutter by copying nearby pixels from the same photo (never generated),
// stored in the recipe so Undo takes it back, and the export shows what the preview shows.

test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'Desktop tool rail and mouse placement.'); });

async function openDustyPhoto(page: Page) {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Spot healing check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  // A soft grey gradient (like out-of-focus sky) with one dark speck of "sensor dust" in the middle.
  const image = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 600; c.height = 400;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 600, 0); g.addColorStop(0, '#6a7480'); g.addColorStop(1, '#a8b2be');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 600, 400);
    ctx.fillStyle = '#1a1a1a'; ctx.beginPath(); ctx.arc(300, 200, 5, 0, Math.PI * 2); ctx.fill();
    return c.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'dust.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') }]);
  const frame = root.getByTestId('canvas-frame');
  await expect(frame.locator('img').first()).toBeVisible({ timeout: 30000 });
  await root.getByRole('button', { name: 'Masks', exact: true }).first().click();
  return { root, frame };
}

/** Mean luminance (0-255) at fractions of the picture's width and height, over a small box. */
async function sample(page: Page, src: string, points: Array<[number, number]>) {
  return page.evaluate(async ({ src, points }) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0);
    return points.map(([fx, fy]) => {
      const x = Math.round(fx * c.width) - 1; const y = Math.round(fy * c.height) - 1;
      const d = ctx.getImageData(x, y, 3, 3).data; let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      return sum / (d.length / 4);
    });
  }, { src, points });
}

async function settledPreview(frame: ReturnType<Page['locator']>) {
  const base = frame.locator('img').first();
  await expect.poll(async () => (await base.getAttribute('src')) ?? '').toMatch(/^blob:/);
  await expect(frame.getByRole('status', { name: 'Refreshing image' })).toHaveCount(0);
  return base;
}

test('a dust spot is covered from nearby pixels, matches in export, and Undo brings it back', async ({ page }) => {
  const { root, frame } = await openDustyPhoto(page);
  const heal = root.getByTestId('v2-heal');
  await expect(heal).toContainText('Spot healing');
  await expect(heal).toContainText('0 spots');

  // Place a spot on the dust.
  await heal.getByTestId('v2-heal-place').click();
  await expect(heal.getByTestId('v2-heal-place')).toHaveAttribute('aria-pressed', 'true');
  const layer = frame.getByTestId('heal-place-layer');
  const box = (await layer.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(heal.getByTestId('v2-heal-note')).toContainText('Spot covered', { timeout: 20000 });
  await expect(heal).toContainText('1 spot');
  await expect(frame.locator('[data-heal-spot]')).toHaveCount(1);

  // The preview no longer shows the dark speck: the centre now matches the gradient just above and below it.
  const points: Array<[number, number]> = [[0.5, 0.5], [0.5, 0.42], [0.5, 0.58], [0.1, 0.1]];
  const base = await settledPreview(frame);
  await expect.poll(async () => {
    const [centre, above, below] = await sample(page, (await base.getAttribute('src'))!, points);
    return Math.abs(centre - (above + below) / 2);
  }, { timeout: 20000 }).toBeLessThan(6);
  const preview = await sample(page, (await base.getAttribute('src'))!, points);

  // Escape stops placing; the selected spot then shows where it copies from.
  await page.keyboard.press('Escape');
  await expect(heal.getByTestId('v2-heal-place')).toHaveAttribute('aria-pressed', 'false');
  await expect(frame.getByTestId('heal-source-handle')).toBeVisible();

  // The export is made from the same recipe and shows the same pixels.
  const dialog = page.getByRole('dialog', { name: /export/i });
  await root.getByRole('button', { name: /^Export/ }).first().click();
  await openExportAdvanced(dialog);
  await dialog.getByLabel('File format').selectOption('png');
  const downloaded = page.waitForEvent('download');
  await dialog.getByRole('button', { name: /export bundle/i }).click();
  const files = Object.entries(unzipSync(await readFile((await (await downloaded).path())!)));
  expect(files).toHaveLength(1);
  const exported = await sample(page, `data:image/png;base64,${Buffer.from(files[0][1]).toString('base64')}`, points);
  for (let i = 0; i < points.length; i++) expect(Math.abs(exported[i] - preview[i])).toBeLessThan(6);
  await page.keyboard.press('Escape');

  // Undo takes the spot away again: the recipe, not the original, held the change.
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect(heal).toContainText('0 spots');
  await expect.poll(async () => (await sample(page, (await (await settledPreview(frame)).getAttribute('src'))!, [[0.5, 0.5]]))[0], { timeout: 20000 }).toBeLessThan(60);
});

test('a spot can switch to an exact clone, copy from elsewhere, be hidden and be removed', async ({ page }) => {
  const { root, frame } = await openDustyPhoto(page);
  const heal = root.getByTestId('v2-heal');
  await heal.getByTestId('v2-heal-place').click();
  const box = (await frame.getByTestId('heal-place-layer').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(heal.getByTestId('v2-heal-note')).toContainText('Spot covered', { timeout: 20000 });
  await heal.getByTestId('v2-heal-place').click();

  const spot = heal.getByTestId('v2-heal-spot');
  await expect(spot).toBeVisible();
  await spot.getByTestId('v2-heal-mode-clone').check();
  await expect(heal.getByTestId('v2-heal-list')).toContainText('Clone');

  // Copy from somewhere else moves the dashed source circle.
  const handle = frame.getByTestId('heal-source-handle');
  const before = (await handle.boundingBox())!;
  await spot.getByTestId('v2-heal-next-source').click();
  await expect.poll(async () => {
    const after = (await handle.boundingBox())!;
    return Math.hypot(after.x - before.x, after.y - before.y);
  }, { timeout: 20000 }).toBeGreaterThan(2);

  // The source can also be moved from the keyboard.
  const moved = (await handle.boundingBox())!;
  await handle.focus();
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(async () => (await handle.boundingBox())!.y).toBeGreaterThan(moved.y);

  await heal.getByRole('button', { name: 'Hide spot: Spot 1' }).click();
  await expect(heal.getByTestId('v2-heal-list')).toContainText('hidden');
  await heal.getByRole('button', { name: 'Remove spot: Spot 1' }).click();
  await expect(heal).toContainText('0 spots');
  await expect(frame.locator('[data-heal-spot]')).toHaveCount(0);
});

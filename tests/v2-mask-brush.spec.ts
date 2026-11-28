import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { openExportAdvanced } from './helpers';

/**
 * Masks › Brush and Eraser (preview `kestrel.preview.mask-brush.v1`, off by default): a stroke painted on the canvas becomes
 * a brush mask, its exposure shows where it was painted, on the canvas and in the exported file, erasing takes it away again
 * and Undo brings it back. Synthetic flat grey photo only.
 */
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'painting on the phone layout is checked in a later slice');
});

async function projectWithGreyPhoto(page: Page, name: string) {
  await page.goto('/?v2');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill(name);
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  await studio.getByRole('button', { name: 'Import', exact: true }).first().waitFor();
  await studio.evaluate((target) => {
    const canvas = document.createElement('canvas');
    canvas.width = 400; canvas.height = 300;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#606060'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const bytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), (c) => c.charCodeAt(0));
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([bytes], 'grey.png', { type: 'image/png' }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
  });
  await expect(studio.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  await expect(studio.getByTestId('canvas-frame').locator('canvas, img').first()).toBeVisible({ timeout: 30000 });
  await studio.getByRole('button', { name: 'Masks', exact: true }).first().click();
  return studio;
}

/** Mean red of a small patch at (fx, fy), 0 to 1 across the picture shown on the canvas. */
function shownRed(studio: Locator, fx: number, fy: number) {
  return studio.getByTestId('canvas-frame').locator('canvas, img').first().evaluate((el, [x, y]) => {
    const source = el as HTMLCanvasElement | HTMLImageElement;
    const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
    const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
    if (!width || !height) return 0;
    const probe = document.createElement('canvas'); probe.width = width; probe.height = height;
    const ctx = probe.getContext('2d')!; ctx.drawImage(source, 0, 0);
    const d = ctx.getImageData(Math.floor(width * x) - 2, Math.floor(height * y) - 2, 4, 4).data;
    let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i];
    return sum / (d.length / 4);
  }, [fx, fy] as const);
}

/** Drag across the picture from (x1, y) to (x2, y), 0 to 1 across the brush layer, in several moves. */
async function stroke(page: Page, studio: Locator, x1: number, x2: number, y: number) {
  const box = (await studio.getByTestId('brush-paint-layer').boundingBox())!;
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) await page.mouse.move(box.x + box.width * (x1 + (x2 - x1) * i / 12), box.y + box.height * y);
  await page.mouse.up();
}

test('Brush and Eraser stay disabled, and say why, while the preview is off', async ({ page }) => {
  const studio = await projectWithGreyPhoto(page, 'Brush off');
  const brush = studio.getByTestId('mask-tool-brush');
  await expect(brush).toBeDisabled();
  await expect(brush).toHaveAttribute('title', /Preview features/);
  await expect(studio.getByTestId('mask-tool-eraser')).toBeDisabled();
});

test('a painted stroke is a mask on the canvas and in the export; Erase removes it and Undo brings it back', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('kestrel.preview.mask-brush.v1', '1'); } catch { /* storage blocked */ } });
  const studio = await projectWithGreyPhoto(page, 'Brush on');

  await studio.getByTestId('mask-tool-brush').click();
  await expect(studio.getByTestId('mask-tool-brush')).toHaveAttribute('aria-pressed', 'true');
  await expect(studio.getByTestId('mask-brush-status')).toContainText('Painting on Brush mask');
  const layer = studio.getByTestId('brush-layer');
  await expect(layer).toHaveAttribute('aria-label', 'Brush on Brush mask');
  await expect(layer).toHaveAttribute('data-mode', 'paint');

  // A bright adjustment on the (still empty) mask changes nothing until it is painted.
  await studio.getByRole('slider', { name: 'Brush mask Exposure' }).fill('2');
  const before = await shownRed(studio, 0.3, 0.5);
  expect(Math.abs(before - (await shownRed(studio, 0.8, 0.5)))).toBeLessThan(4);

  // The size slider and ] / [ change the brush; the ring follows the pointer.
  const size = studio.getByTestId('mask-brush-size');
  await size.fill('30');
  await page.keyboard.press(']');
  await expect(size).toHaveValue('35');
  await page.keyboard.press('[');
  await expect(size).toHaveValue('30');

  await stroke(page, studio, 0.15, 0.45, 0.5);
  await expect(studio.getByRole('button', { name: /Brush mask.*1 brush stroke/ })).toBeVisible();
  await expect.poll(async () => (await shownRed(studio, 0.3, 0.5)) - before, { timeout: 15000 }).toBeGreaterThan(15);
  expect(Math.abs((await shownRed(studio, 0.85, 0.5)) - before)).toBeLessThan(4);

  // The exported file carries the same mask: bright where painted, the photo's own grey elsewhere.
  const dialog = page.getByRole('dialog', { name: /export/i });
  await studio.getByRole('button', { name: /^Export/ }).first().click();
  await expect(dialog).toBeVisible();
  await openExportAdvanced(dialog);
  await dialog.getByLabel('File format').selectOption('png');
  const downloaded = page.waitForEvent('download');
  await dialog.getByRole('button', { name: /export bundle/i }).click();
  const files = unzipSync(await readFile((await (await downloaded).path())!));
  const [[, bytes]] = Object.entries(files);
  const exported = await page.evaluate(async (encoded) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const red = (fx: number, fy: number) => ctx.getImageData(Math.floor(bitmap.width * fx), Math.floor(bitmap.height * fy), 1, 1).data[0];
    return { width: bitmap.width, painted: red(0.3, 0.5), unpainted: red(0.85, 0.5) };
  }, Buffer.from(bytes).toString('base64'));
  expect(exported.width).toBe(400);
  expect(exported.painted - exported.unpainted).toBeGreaterThan(15);
  expect(Math.abs(exported.unpainted - 0x60)).toBeLessThan(6);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // Erase over the same place: the ring is dashed (data-erase) and the stroke takes the adjustment away.
  await studio.getByTestId('mask-brush-mode-eraser').click();
  await expect(studio.getByTestId('mask-brush-status')).toContainText('Erasing from Brush mask');
  await expect(layer).toHaveAttribute('data-mode', 'erase');
  await stroke(page, studio, 0.1, 0.5, 0.5);
  await expect(studio.getByRole('button', { name: /Brush mask.*2 brush strokes/ })).toBeVisible();
  await expect.poll(async () => Math.abs((await shownRed(studio, 0.3, 0.5)) - before), { timeout: 15000 }).toBeLessThan(6);

  // Undo (the keyboard shortcut) removes the erase stroke in one step.
  await studio.getByTestId('mask-brush-mode-eraser').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(studio.getByRole('button', { name: /Brush mask.*1 brush stroke/ })).toBeVisible();
  await expect.poll(async () => (await shownRed(studio, 0.3, 0.5)) - before, { timeout: 15000 }).toBeGreaterThan(15);
});

test('the keyboard paints too: arrow keys move the brush and Space paints a dab', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('kestrel.preview.mask-brush.v1', '1'); } catch { /* storage blocked */ } });
  const studio = await projectWithGreyPhoto(page, 'Brush keys');
  await studio.getByTestId('mask-tool-brush').click();
  const layer = studio.getByTestId('brush-layer');
  await layer.focus();
  await expect(studio.getByTestId('brush-ring')).toBeVisible();
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Space');
  await expect(studio.getByRole('button', { name: /Brush mask.*1 brush stroke/ })).toBeVisible();
});

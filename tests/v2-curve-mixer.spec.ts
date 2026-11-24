import { expect, test, type Locator, type Page } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'the V2 phone layout is checked in a later slice');
});

/** A new V2 project with one synthetic photo: a slate-blue background and an orange box. */
async function projectWithPhoto(page: Page): Promise<Locator> {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Curve and mixer check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 160;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#3c4a5c'; ctx.fillRect(0, 0, 240, 160);
    ctx.fillStyle = '#d08a3a'; ctx.fillRect(60, 40, 120, 80);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'curve-1.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  await expect(root.getByTestId('canvas-frame').locator('canvas, img').first()).toBeVisible({ timeout: 30000 });
  const advanced = root.getByRole('tab', { name: 'Advanced Edits' });
  if (!(await advanced.isVisible())) await root.getByRole('button', { name: 'Adjust', exact: true }).first().click();
  await advanced.click();
  return root;
}

/** Mean brightness of the whole picture, and the colour spread (max minus min channel) at the centre of the orange box. */
function measure(root: Locator) {
  return root.getByTestId('canvas-frame').locator('canvas, img').first().evaluate((el) => {
    const source = el as HTMLCanvasElement | HTMLImageElement;
    const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
    const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
    if (!width || !height) return { mean: 0, spread: 0 };
    const probe = document.createElement('canvas'); probe.width = width; probe.height = height;
    const ctx = probe.getContext('2d')!; ctx.drawImage(source, 0, 0);
    const data = ctx.getImageData(0, 0, width, height).data;
    let total = 0; for (let i = 0; i < data.length; i += 4) total += data[i] + data[i + 1] + data[i + 2];
    const c = ctx.getImageData(Math.floor(width / 2), Math.floor(height / 2), 1, 1).data;
    return { mean: total / (data.length / 4 * 3), spread: Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]) };
  });
}

test('?v2 tone curve: moving the black point with the keyboard brightens the picture, and undo restores it', async ({ page }) => {
  const root = await projectWithPhoto(page);
  await expect.poll(async () => (await measure(root)).mean).toBeGreaterThan(10);
  const before = (await measure(root)).mean;
  const curve = root.getByTestId('tone-curve');
  const blackPoint = curve.getByRole('slider', { name: 'Curve point' }).first();
  await blackPoint.focus();
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('Shift+ArrowUp');
  await expect(blackPoint).toHaveAttribute('aria-valuenow', '30');
  await expect.poll(async () => (await measure(root)).mean, { timeout: 15000 }).toBeGreaterThan(before + 10);
  // A preset replaces the curve with plain-word starting points; Reset returns to a straight line.
  await curve.getByRole('button', { name: 'Reset curve' }).click();
  await expect.poll(async () => Math.abs((await measure(root)).mean - before), { timeout: 15000 }).toBeLessThan(1.5);
  // A preset starts the curve from plain-word points: Faded blacks lifts pure black to 8%.
  await curve.getByRole('button', { name: 'Faded blacks' }).click();
  await expect(blackPoint).toHaveAttribute('aria-valuenow', '8');
  await expect(curve.getByRole('slider', { name: 'Curve point' })).toHaveCount(3);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  // Every step is undoable; undo enough times and the picture is as it was.
  for (let i = 0; i < 8; i += 1) await page.keyboard.press('Control+z');
  await expect.poll(async () => Math.abs((await measure(root)).mean - before), { timeout: 15000 }).toBeLessThan(1.5);
});

test('?v2 colour mixer: removing orange greys the orange box and leaves the slate background alone', async ({ page }) => {
  const root = await projectWithPhoto(page);
  await expect.poll(async () => (await measure(root)).spread).toBeGreaterThan(60);
  const mixer = root.getByTestId('colour-mixer');
  await mixer.getByRole('radio', { name: 'Orange' }).click();
  await expect(mixer.getByRole('radio', { name: 'Orange' })).toHaveAttribute('aria-checked', 'true');
  await mixer.getByLabel('Orange saturation').fill('-100');
  await expect.poll(async () => (await measure(root)).spread, { timeout: 15000 }).toBeLessThan(15);
  // The band now says it is changed in words, not only with a mark.
  await expect(mixer.getByRole('radio', { name: /Orange.*changed/ })).toBeVisible();
  await mixer.getByRole('button', { name: 'Reset mixer' }).click();
  await expect.poll(async () => (await measure(root)).spread, { timeout: 15000 }).toBeGreaterThan(60);
});

import { expect, test, type Locator, type Page } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'the V2 phone layout is checked in a later slice');
});

const png = async (page: Page, width: number, height: number, colour: string) => Buffer.from(await page.evaluate(([w, h, c]) => {
  const canvas = document.createElement('canvas'); canvas.width = Number(w); canvas.height = Number(h);
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = String(c); ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png').split(',')[1];
}, [width, height, colour] as const), 'base64');

/** Average colour of a small patch at (fx, fy), 0 to 1 across the picture shown on the canvas. */
function sample(root: Locator, fx: number, fy: number) {
  return root.getByTestId('canvas-frame').locator('canvas, img').first().evaluate((el, [x, y]) => {
    const source = el as HTMLCanvasElement | HTMLImageElement;
    const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
    const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
    if (!width || !height) return [0, 0, 0];
    const probe = document.createElement('canvas'); probe.width = width; probe.height = height;
    const ctx = probe.getContext('2d')!; ctx.drawImage(source, 0, 0);
    const d = ctx.getImageData(Math.floor(width * x) - 2, Math.floor(height * y) - 2, 4, 4).data;
    const sum = [0, 0, 0]; for (let i = 0; i < d.length; i += 4) { sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2]; }
    return sum.map((v) => v / (d.length / 4));
  }, [fx, fy] as const);
}

test('?v2 layers: add an image, see it on the picture, blend it, move it, hide it and undo', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Layers check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([
    { name: 'base.png', mimeType: 'image/png', buffer: await png(page, 300, 200, '#808080') },
    { name: 'second.png', mimeType: 'image/png', buffer: await png(page, 300, 200, '#2050c0') },
  ]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(2);
  await root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option').first().click();
  await expect(root.getByTestId('canvas-frame').locator('canvas, img').first()).toBeVisible({ timeout: 30000 });
  await root.getByRole('button', { name: 'Overlays', exact: true }).first().click();
  await root.getByRole('button', { name: 'Layers', exact: true }).click();
  const layers = root.getByTestId('layers');
  await expect(layers.getByText('Always at the bottom')).toBeVisible();
  await expect.poll(async () => (await sample(root, 0.5, 0.5))[0]).toBeGreaterThan(100);
  const [grey] = await sample(root, 0.5, 0.5);

  // A red logo in the middle.
  const picker = page.waitForEvent('filechooser');
  await layers.getByRole('button', { name: 'Add image…' }).click();
  await (await picker).setFiles([{ name: 'logo.png', mimeType: 'image/png', buffer: await png(page, 100, 100, '#e01010') }]);
  await expect(layers.getByRole('button', { name: 'logo', exact: true })).toBeVisible();
  await expect.poll(async () => { const [r, g] = await sample(root, 0.5, 0.5); return r - g; }, { timeout: 15000 }).toBeGreaterThan(150);
  // The corner is still the photo.
  expect(Math.abs((await sample(root, 0.05, 0.05))[0] - grey)).toBeLessThan(4);

  // Darken keeps the darker of each channel: red over grey gives a dark red.
  await layers.getByRole('radio', { name: 'Darken' }).click();
  await expect.poll(async () => { const [r, g] = await sample(root, 0.5, 0.5); return Math.abs(r - grey) < 6 && g < 40; }, { timeout: 15000 }).toBe(true);
  await layers.getByRole('radio', { name: 'Normal' }).click();

  // Move it with the keyboard on the position map: the middle is the photo again, the layer is further right.
  const pad = layers.getByTestId('layer-position-pad');
  await pad.focus();
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => { const [r, g] = await sample(root, 0.5, 0.5); return r - g; }, { timeout: 15000 }).toBeLessThan(10);
  await expect.poll(async () => { const [r, g] = await sample(root, 0.8, 0.5); return r - g; }, { timeout: 15000 }).toBeGreaterThan(150);

  // Hide and show.
  await layers.getByRole('button', { name: 'Hide logo' }).click();
  await expect.poll(async () => { const [r, g] = await sample(root, 0.8, 0.5); return r - g; }, { timeout: 15000 }).toBeLessThan(10);
  await layers.getByRole('button', { name: 'Show logo' }).click();
  await expect.poll(async () => { const [r, g] = await sample(root, 0.8, 0.5); return r - g; }, { timeout: 15000 }).toBeGreaterThan(150);

  // Another photo of the project as a layer, under a soft oval.
  await layers.getByRole('button', { name: 'Add a photo from this project' }).click();
  await layers.getByRole('button', { name: 'second.png' }).click();
  await expect(layers.getByRole('button', { name: 'second.png', exact: true })).toBeVisible({ timeout: 15000 });
  await expect.poll(async () => { const [r, , b] = await sample(root, 0.5, 0.5); return b - r; }, { timeout: 15000 }).toBeGreaterThan(100);

  // Undo takes the last layer away again.
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect.poll(async () => { const [r, , b] = await sample(root, 0.5, 0.5); return Math.abs(b - r); }, { timeout: 15000 }).toBeLessThan(10);
});

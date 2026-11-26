import { expect, test, type Page } from '@playwright/test';

// Focus stacking (preview, off by default): three frames of a synthetic focus bracket, each sharp in one third, become
// one new linked photo that is sharper than every frame. The originals stay in the project unchanged, the new photo
// says what it was made from, and it is offered by default (an admin flag can switch it off).

test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'Desktop filmstrip menu and shift-click selection.'); });

const W = 480, H = 320;

/** Three PNGs: one seeded texture, each frame sharp in its own vertical third and blurred elsewhere. */
async function bracket(page: Page): Promise<string[]> {
  return page.evaluate(({ W, H }) => {
    let seed = 12345;
    const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    const sharp = document.createElement('canvas'); sharp.width = W; sharp.height = H;
    const s = sharp.getContext('2d')!;
    s.fillStyle = '#7a8070'; s.fillRect(0, 0, W, H);
    for (let i = 0; i < 2600; i++) {
      const v = Math.floor(rand() * 255);
      s.fillStyle = `rgb(${v},${Math.floor(v * 0.9)},${Math.floor(v * 0.75)})`;
      s.fillRect(Math.floor(rand() * W), Math.floor(rand() * H), 1 + Math.floor(rand() * 4), 1 + Math.floor(rand() * 4));
    }
    return [0, 1, 2].map((i) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d')!;
      ctx.filter = 'blur(4px)'; ctx.drawImage(sharp, 0, 0); ctx.filter = 'none';
      ctx.save(); ctx.beginPath(); ctx.rect((i * W) / 3, 0, W / 3, H); ctx.clip(); ctx.drawImage(sharp, 0, 0); ctx.restore();
      return c.toDataURL('image/png').split(',')[1];
    });
  }, { W, H });
}

async function openBracket(page: Page, preview: boolean) {
  if (preview) await page.addInitScript(() => localStorage.setItem('kestrel.preview.focus-stack.v1', '1'));
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Focus stack check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const frames = await bracket(page);
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles(frames.map((data, i) => ({ name: `macro_${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') })));
  const strip = root.getByRole('listbox', { name: 'Project photographs' });
  await expect(strip.getByRole('option')).toHaveCount(3, { timeout: 30000 });
  return { root, strip };
}

/** Mean |Laplacian| of the luminance of a picture at its own size, away from the border. */
async function sharpness(page: Page, src: string) {
  return page.evaluate(async (src) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    const l = (x: number, y: number) => { const p = (y * width + x) * 4; return 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]; };
    let sum = 0, n = 0;
    for (let y = 8; y < height - 8; y++) for (let x = 8; x < width - 8; x++) { sum += Math.abs(4 * l(x, y) - l(x - 1, y) - l(x + 1, y) - l(x, y - 1) - l(x, y + 1)); n++; }
    return { value: sum / n, width, height };
  }, src);
}

async function shownPicture(root: ReturnType<Page['locator']>) {
  const frame = root.getByTestId('canvas-frame');
  const base = frame.locator('img').first();
  await expect.poll(async () => (await base.getAttribute('src')) ?? '').toMatch(/^blob:/);
  await expect(frame.getByRole('status', { name: 'Refreshing image' })).toHaveCount(0);
  return (await base.getAttribute('src'))!;
}

test('three bracketed frames become one new photo that is sharper than every frame, originals unchanged', async ({ page }) => {
  const { root, strip } = await openBracket(page, true);
  const options = strip.getByRole('option');
  const inputs: number[] = [];
  for (let i = 0; i < 3; i++) {
    await options.nth(i).click();
    const measured = await sharpness(page, await shownPicture(root));
    expect(measured.width).toBe(W);
    inputs.push(measured.value);
  }
  await options.nth(0).click();
  await options.nth(2).click({ modifiers: ['Shift'] });
  await options.nth(1).click({ button: 'right' });
  const menu = root.getByRole('menu');
  await menu.getByRole('menuitem', { name: 'Focus stack 3 photos' }).click();
  await expect(root.getByText(/Added macro_1-stack3\.png, stacked from 3 photos\. Your original photos are untouched\./)).toBeVisible({ timeout: 60000 });
  await expect(options).toHaveCount(4);
  // It ran in the background worker: no note that it had to run on the interface thread.
  await expect(root.getByText(/could not run in the background/)).toHaveCount(0);

  const stacked = strip.getByRole('option', { name: /macro_1-stack3\.png/ });
  await stacked.click();
  const result = await sharpness(page, await shownPicture(root));
  expect(result.width).toBe(W);
  expect(result.height).toBe(H);
  for (const value of inputs) expect(result.value).toBeGreaterThan(value * 1.2);

  await root.getByRole('button', { name: 'Info', exact: true }).first().click();
  const info = root.getByTestId('v2-focus-stack-info');
  await expect(info).toContainText('Made from 3 photos:');
  for (const name of ['macro_1.png', 'macro_2.png', 'macro_3.png']) await expect(info).toContainText(name);
  await expect(info).toContainText('No pixels were generated.');

  // The sources are still there, unchanged.
  await options.nth(0).click();
  expect((await sharpness(page, await shownPicture(root))).value).toBeCloseTo(inputs[0], 1);
});

test('on by default: without the device switch the photo menu still offers focus stacking', async ({ page }) => {
  const { root, strip } = await openBracket(page, false);
  const options = strip.getByRole('option');
  await options.nth(0).click();
  await options.nth(2).click({ modifiers: ['Shift'] });
  await options.nth(1).click({ button: 'right' });
  const menu = root.getByRole('menu');
  await expect(menu.getByRole('menuitem').first()).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Focus stack/ }).first()).toBeVisible();
});

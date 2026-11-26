import { expect, test, type Page } from '@playwright/test';

// HDR merge (preview, off by default): a synthetic three-frame bracket (−2, 0 and +2 stops of one scene that spans far
// more than one frame can hold) becomes one new linked photo that keeps detail where the middle frame is blown out and
// where it is nearly black. The originals stay in the project unchanged, the new photo says what it was made from and
// each frame's measured exposure, and with the preview switch off the menu does not offer it at all.

test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'Desktop filmstrip menu and shift-click selection.'); });

const W = 480, H = 320;

/** Three PNGs of one scene in linear light, from deep shadow at the left to far beyond white at the right, textured. */
async function bracket(page: Page): Promise<string[]> {
  return page.evaluate(({ W, H }) => {
    const encode = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
    return [-2, 0, 2].map((ev) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d')!;
      const img = ctx.createImageData(W, H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const L = 0.003 * Math.pow(3000, x / (W - 1)) * (1 + 0.4 * Math.sin(x / 5.3) * Math.sin(y / 6.1));
        const v = Math.round(Math.min(1, encode(Math.min(1, L * 2 ** ev))) * 255);
        const i = (y * W + x) * 4;
        img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      return c.toDataURL('image/png').split(',')[1];
    });
  }, { W, H });
}

async function openBracket(page: Page, preview: boolean) {
  if (preview) await page.addInitScript(() => localStorage.setItem('kestrel.preview.hdr-merge.v1', '1'));
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('HDR check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const frames = await bracket(page);
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles(frames.map((data, i) => ({ name: `dawn_${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') })));
  const strip = root.getByRole('listbox', { name: 'Project photographs' });
  await expect(strip.getByRole('option')).toHaveCount(3, { timeout: 30000 });
  return { root, strip };
}

/** Spread of luminance (standard deviation, 0-255) in a vertical strip of columns, and the picture's size. */
async function detail(page: Page, src: string, x0: number, x1: number) {
  return page.evaluate(async ({ src, x0, x1 }) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    const values: number[] = [];
    for (let y = 8; y < height - 8; y++) for (let x = Math.round(x0 * width); x < Math.round(x1 * width); x++) values.push(data[(y * width + x) * 4 + 1]);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
    return { sd, mean, width, height };
  }, { src, x0, x1 });
}

async function shownPicture(root: ReturnType<Page['locator']>) {
  const frame = root.getByTestId('canvas-frame');
  const base = frame.locator('img').first();
  await expect.poll(async () => (await base.getAttribute('src')) ?? '').toMatch(/^blob:/);
  await expect(frame.getByRole('status', { name: 'Refreshing image' })).toHaveCount(0);
  return (await base.getAttribute('src'))!;
}

test('a three-frame bracket becomes one new photo with detail where the middle frame is blown out, originals unchanged', async ({ page }) => {
  const { root, strip } = await openBracket(page, true);
  const options = strip.getByRole('option');
  await options.nth(1).click();
  const middleSrc = await shownPicture(root);
  const middleHighlights = await detail(page, middleSrc, 0.85, 0.98);
  expect(middleHighlights.mean).toBeGreaterThan(250); // the middle frame really is blown out there

  await options.nth(0).click();
  await options.nth(2).click({ modifiers: ['Shift'] });
  await options.nth(1).click({ button: 'right' });
  const menu = root.getByRole('menu');
  await menu.getByRole('menuitem', { name: 'Merge 3 photos to HDR' }).click();
  await expect(root.getByText(/Added dawn_1-hdr3\.png, merged from 3 photos\. Your original photos are untouched\./)).toBeVisible({ timeout: 60000 });
  await expect(options).toHaveCount(4);
  // It ran in the background worker: no note that it had to run on the interface thread.
  await expect(root.getByText(/could not run in the background/)).toHaveCount(0);

  await strip.getByRole('option', { name: /dawn_1-hdr3\.png/ }).click();
  const mergedSrc = await shownPicture(root);
  const highlights = await detail(page, mergedSrc, 0.85, 0.98);
  expect(highlights.width).toBe(W);
  expect(highlights.height).toBe(H);
  expect(highlights.mean).toBeLessThan(250);
  expect(highlights.sd).toBeGreaterThan(middleHighlights.sd * 3 + 2);

  await root.getByRole('button', { name: 'Info', exact: true }).first().click();
  const info = root.getByTestId('v2-hdr-merge-info');
  await expect(info).toContainText('Made from 3 photos:');
  await expect(info).toContainText(/dawn_1\.png: −2 stops/);
  await expect(info).toContainText(/dawn_2\.png: 0 stops/);
  await expect(info).toContainText(/dawn_3\.png: \+2 stops/);
  await expect(info).toContainText('No pixels were generated.');

  // The sources are still there, unchanged.
  await options.nth(1).click();
  const again = await detail(page, await shownPicture(root), 0.85, 0.98);
  expect(again.mean).toBeCloseTo(middleHighlights.mean, 1);
});

test('with the preview off, the photo menu does not offer HDR merge', async ({ page }) => {
  const { root, strip } = await openBracket(page, false);
  const options = strip.getByRole('option');
  await options.nth(0).click();
  await options.nth(2).click({ modifiers: ['Shift'] });
  await options.nth(1).click({ button: 'right' });
  const menu = root.getByRole('menu');
  await expect(menu.getByRole('menuitem').first()).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /HDR/ })).toHaveCount(0);
});

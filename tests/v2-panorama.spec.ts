import { expect, test, type Page } from '@playwright/test';

// Panorama stitching (preview, off by default): three overlapping frames of one synthetic scene become one new linked
// photo, wider than any frame and cropped to real pixels. The originals stay in the project unchanged, the new photo
// says what it was made from, and it is offered by default (an admin flag can switch it off).

test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'Desktop filmstrip menu and shift-click selection.'); });

const W = 420, H = 300, SHIFT = 260;

/** Three PNGs cut from one seeded texture, each SHIFT pixels to the right of the last (about 38% overlap). */
async function sweep(page: Page): Promise<string[]> {
  return page.evaluate(({ W, H, SHIFT }) => {
    let seed = 2468;
    const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    const scene = document.createElement('canvas'); scene.width = W + SHIFT * 2; scene.height = H;
    const s = scene.getContext('2d')!;
    s.fillStyle = '#6f7a86'; s.fillRect(0, 0, scene.width, H);
    for (let i = 0; i < 2200; i++) {
      s.fillStyle = `rgb(${Math.floor(rand() * 255)},${Math.floor(rand() * 255)},${Math.floor(rand() * 255)})`;
      s.fillRect(Math.floor(rand() * scene.width), Math.floor(rand() * H), 3 + Math.floor(rand() * 16), 3 + Math.floor(rand() * 16));
    }
    const soft = document.createElement('canvas'); soft.width = scene.width; soft.height = H;
    const t = soft.getContext('2d')!; t.filter = 'blur(1px)'; t.drawImage(scene, 0, 0);
    return [0, 1, 2].map((i) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      c.getContext('2d')!.drawImage(soft, i * SHIFT, 0, W, H, 0, 0, W, H);
      return c.toDataURL('image/png').split(',')[1];
    });
  }, { W, H, SHIFT });
}

async function openSweep(page: Page, preview: boolean) {
  if (preview) await page.addInitScript(() => localStorage.setItem('kestrel.preview.panorama.v1', '1'));
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Panorama check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const frames = await sweep(page);
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles(frames.map((data, i) => ({ name: `coast_${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') })));
  const strip = root.getByRole('listbox', { name: 'Project photographs' });
  await expect(strip.getByRole('option')).toHaveCount(3, { timeout: 30000 });
  return { root, strip };
}

async function shownSize(page: Page, root: ReturnType<Page['locator']>) {
  const frame = root.getByTestId('canvas-frame');
  const base = frame.locator('img').first();
  await expect.poll(async () => (await base.getAttribute('src')) ?? '').toMatch(/^blob:/);
  await expect(frame.getByRole('status', { name: 'Refreshing image' })).toHaveCount(0);
  const src = (await base.getAttribute('src'))!;
  return page.evaluate(async (src) => {
    const img = new Image(); img.src = src; await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  }, src);
}

test('three overlapping frames become one new, wider photo cropped to real pixels, originals unchanged', async ({ page }) => {
  const { root, strip } = await openSweep(page, true);
  const options = strip.getByRole('option');
  await options.nth(0).click();
  await options.nth(2).click({ modifiers: ['Shift'] });
  await options.nth(1).click({ button: 'right' });
  await root.getByRole('menu').getByRole('menuitem', { name: 'Stitch 3 photos into a panorama' }).click();
  await expect(root.getByText(/Added coast_1-pano3\.png, stitched from 3 photos\. Your original photos are untouched\./)).toBeVisible({ timeout: 90000 });
  await expect(root.getByText(/Nothing was filled in\./)).toBeVisible();
  await expect(options).toHaveCount(4);
  // It ran in the background worker: no note that it had to run on the interface thread.
  await expect(root.getByText(/could not run in the background/)).toHaveCount(0);

  await strip.getByRole('option', { name: /coast_1-pano3\.png/ }).click();
  const size = await shownSize(page, root);
  // Three frames 260 px apart cover 940 px; the honest crop keeps nearly all of it and never adds height.
  expect(size.width).toBeGreaterThan(W + SHIFT * 2 - 40);
  expect(size.width).toBeLessThanOrEqual(W + SHIFT * 2 + 4);
  expect(size.height).toBeLessThanOrEqual(H);
  expect(size.height).toBeGreaterThan(H - 30);

  await root.getByRole('button', { name: 'Info', exact: true }).first().click();
  await root.getByTestId('info-tab-technical').click(); // the file's details are on the second tab
  const info = root.getByTestId('v2-panorama-info');
  await expect(info).toContainText('Stitched from 3 photos:');
  for (const name of ['coast_1.png', 'coast_2.png', 'coast_3.png']) await expect(info).toContainText(name);
  await expect(info).toContainText('No pixels were generated.');

  // The sources are still there, at their own size.
  await options.nth(0).click();
  expect(await shownSize(page, root)).toEqual({ width: W, height: H });
});

test('on by default: without the device switch the photo menu still offers panorama stitching', async ({ page }) => {
  const { root, strip } = await openSweep(page, false);
  const options = strip.getByRole('option');
  await options.nth(0).click();
  await options.nth(2).click({ modifiers: ['Shift'] });
  await options.nth(1).click({ button: 'right' });
  const menu = root.getByRole('menu');
  await expect(menu.getByRole('menuitem').first()).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /panorama/ }).first()).toBeVisible();
});

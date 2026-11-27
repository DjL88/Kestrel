import { expect, test, type Page } from '@playwright/test';

// Owner, 27 Nov (Windows laptop touchpad): "Zoom in/out on the canvas jumps around". A touchpad pinch reaches the page
// as Ctrl+wheel; the point of the picture under the fingers must stay under them while it zooms in and back out.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'A touchpad pinch (Ctrl+wheel) is a desktop gesture; touch pinch is in v2-phone-uat.');
});

async function importPicture(page: Page, size = { width: 3000, height: 2000 }) {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Pinch check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const png = await page.evaluate((wanted) => {
    const canvas = document.createElement('canvas'); canvas.width = wanted.width; canvas.height = wanted.height;
    const ctx = canvas.getContext('2d')!;
    for (let y = 0; y < wanted.height / 100; y += 1) for (let x = 0; x < wanted.width / 100; x += 1) {
      ctx.fillStyle = (x + y) % 2 ? '#6a7a8a' : '#a0886a'; ctx.fillRect(x * 100, y * 100, 100, 100);
    }
    return canvas.toDataURL('image/png').split(',')[1];
  }, size);
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'checks.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1, { timeout: 30000 });
  await expect(root.getByTestId('zoom-percent')).not.toHaveText('100%', { timeout: 30000 });
  // The picture has its size on screen before anything is measured: on a slow start the first box read 0×0, and the
  // corner test then compared Fit against nothing ("off by 808 px").
  await expect.poll(async () => (await pictureBox(page).catch(() => ({ width: 0 }))).width, { timeout: 30000 }).toBeGreaterThan(50);
  await page.waitForTimeout(150);
  return root;
}

/** The picture in the frame, on screen. */
const pictureBox = (page: Page) => page.evaluate(() => {
  const frame = document.querySelector('.inflight-v2 [data-testid="canvas-frame"]')!;
  const pics = [...frame.querySelectorAll('img, canvas')] as HTMLElement[];
  const r = pics.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0].getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
});

type Box = { left: number; top: number; width: number; height: number };
/**
 * Zooming out (Dave, 27 Nov): the picture moves steadily back to where it sits at Fit. Its centre's offset from the Fit
 * centre shrinks in step with the zoom: offset after = offset before × (width after − Fit width) / (width before − Fit
 * width), so it is centred exactly when Fit is reached. Returns how far, in px, each axis is from that.
 */
function offTowardsFit(fit: Box, before: Box, after: Box) {
  const centre = (b: Box) => ({ x: b.left + b.width / 2, y: b.top + b.height / 2 });
  const [f, b, a] = [centre(fit), centre(before), centre(after)];
  const share = Math.max(0, after.width - fit.width) / Math.max(1e-6, before.width - fit.width);
  return { x: Math.abs(a.x - (f.x + (b.x - f.x) * share)), y: Math.abs(a.y - (f.y + (b.y - f.y) * share)) };
}

/** A touchpad pinch: Ctrl held, many small wheel steps sent as fast as a touchpad does (negative zooms in). */
async function pinch(page: Page, steps: number, deltaY: number) {
  await page.keyboard.down('Control');
  for (let step = 0; step < steps; step += 1) await page.mouse.wheel(0, deltaY);
  await page.keyboard.up('Control');
  await page.waitForTimeout(250);
}

test('a touchpad pinch (Ctrl+wheel) in keeps the picture point under the fingers in place; out heads back to Fit', async ({ page }) => {
  const root = await importPicture(page);
  const start = await pictureBox(page);
  // A point off the middle of the picture, so a zoom about the centre would visibly move it.
  // Whole pixels: the pointer's position reaches the page in whole pixels, so a fractional point would start the check
  // a fraction of a pixel off, and 8× zoom would multiply that.
  const at = { x: Math.round(start.left + start.width * 0.7), y: Math.round(start.top + start.height * 0.35) };
  const share = { fx: (at.x - start.left) / start.width, fy: (at.y - start.top) / start.height };
  await page.mouse.move(at.x, at.y);
  const drift = async () => {
    const box = await pictureBox(page);
    return Math.hypot(box.left + share.fx * box.width - at.x, box.top + share.fy * box.height - at.y);
  };

  await pinch(page, 24, -12);
  const zoomedIn = await pictureBox(page);
  expect(zoomedIn.width).toBeGreaterThan(start.width * 4);
  // Within the whole-pixel rounding of the scroll and layout: under 0.1% of the picture at the 8× limit (it drifted by about
  // 200 px before).
  expect(await drift(), 'the point under the fingers moved while zooming in').toBeLessThanOrEqual(4);
  await pinch(page, 12, 12);
  const out = await pictureBox(page);
  expect(out.width).toBeLessThan(zoomedIn.width / 2);
  const off = offTowardsFit(start, zoomedIn, out);
  expect(off.x, 'pinching out, the picture moved back towards Fit steadily (across)').toBeLessThanOrEqual(4);
  expect(off.y, 'pinching out, the picture moved back towards Fit steadily (up and down)').toBeLessThanOrEqual(4);

  // The page itself never zoomed: the browser's own pinch-zoom was held back.
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
  await expect(root.getByTestId('zoom-percent')).not.toHaveText('100%');
});

test('two-finger scroll (a plain wheel without Ctrl) pans the zoomed picture and does not zoom', async ({ page }) => {
  const root = await importPicture(page);
  const at = await pictureBox(page);
  await page.mouse.move(at.left + at.width / 2, at.top + at.height / 2);
  await pinch(page, 24, -12);
  // The pinch zoomed in, well past the view, so there is room to pan (a slow runner once panned a picture still at Fit).
  await expect.poll(async () => (await pictureBox(page)).width, { timeout: 10000 }).toBeGreaterThan(at.width * 3);
  const zoomed = await root.getByTestId('zoom-percent').textContent();
  const before = await pictureBox(page);
  // Small, smooth deltas with a sideways part, as a touchpad's two-finger scroll sends them.
  for (let step = 0; step < 10; step += 1) await page.mouse.wheel(7, 9);
  // Chromium animates wheel scrolling, and a loaded runner takes longer than a fixed wait to finish it.
  await expect.poll(async () => {
    const now = await pictureBox(page);
    return Math.abs(now.top - before.top) + Math.abs(now.left - before.left);
  }, { timeout: 5000 }).toBeGreaterThan(20);
  const after = await pictureBox(page);
  expect(after.width).toBeCloseTo(before.width, 0);
  await expect(root.getByTestId('zoom-percent')).toHaveText(zoomed!);
});

// Dave, 27 Nov (installed build, a portrait 2672×4000 puffin): after zooming to the eye, + moved the head to the bottom
// edge and a second + jumped to the photo's top-left corner. His rules: + (no pointer) holds the eye, else the subject,
// else the middle of the picture; a pinch holds the fingers; − heads steadily back to Fit. A checkerboard has no eye or
// subject, so + holds the middle of the picture.
test('on a portrait photo larger than the view, + holds the middle of the picture, a pinch the fingers, and − heads back to Fit', async ({ page }) => {
  const root = await importPicture(page, { width: 2672, height: 4000 });
  const fit = await pictureBox(page);
  const middle = () => page.evaluate(() => {
    const stage = document.querySelector('.inflight-v2 [data-testid="canvas-stage"]') as HTMLElement;
    const r = stage.getBoundingClientRect();
    return { x: r.left + stage.clientWidth / 2, y: r.top + stage.clientHeight / 2 };
  });
  /** Where the picture point now at this screen spot is after the next zoom, against the spot itself. */
  const track = async (spot: { x: number; y: number }) => {
    const box = await pictureBox(page);
    const share = { fx: (spot.x - box.left) / box.width, fy: (spot.y - box.top) / box.height };
    return async () => {
      const now = await pictureBox(page);
      return Math.hypot(now.left + share.fx * now.width - spot.x, now.top + share.fy * now.height - spot.y);
    };
  };
  const zoomIn = root.getByRole('button', { name: 'Zoom in', exact: true });
  const zoomOut = root.getByRole('button', { name: 'Zoom out', exact: true });
  const percent = root.getByTestId('zoom-percent');
  // Far enough in that the portrait photo is taller and wider than the view; each step checked.
  for (let step = 0; step < 8; step += 1) {
    const was = await percent.textContent();
    const box = await pictureBox(page);
    const drift = await track({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
    await zoomIn.click();
    await expect(percent).not.toHaveText(was!);
    await page.waitForTimeout(150);
    expect(await drift(), `+ step ${step + 1}: the middle of the picture moved`).toBeLessThanOrEqual(4);
  }
  void middle;
  const big = await pictureBox(page);
  const view = await page.evaluate(() => (document.querySelector('.inflight-v2 [data-testid="canvas-stage"]') as HTMLElement).getBoundingClientRect().toJSON());
  expect(big.height).toBeGreaterThan(view.height);
  expect(big.width).toBeGreaterThan(view.width);
  // A pinch off the middle, larger than the view.
  const spot = { x: Math.round(view.left + view.width * 0.3), y: Math.round(view.top + view.height * 0.6) };
  await page.mouse.move(spot.x, spot.y);
  const pinchDrift = await track(spot);
  await pinch(page, 8, -12);
  expect(await pinchDrift(), 'the pinch point moved').toBeLessThanOrEqual(4);
  for (let step = 0; step < 3; step += 1) {
    const was = await percent.textContent();
    const before = await pictureBox(page);
    await zoomOut.click();
    await expect(percent).not.toHaveText(was!);
    await page.waitForTimeout(150);
    const off = offTowardsFit(fit, before, await pictureBox(page));
    expect(Math.max(off.x, off.y), `− step ${step + 1}: the picture did not head steadily back to Fit`).toBeLessThanOrEqual(4);
  }
});

// The slider session, 27 Nov: in the browser "100%" showed about 87% of a 6,000 px PNG, because the size the canvas
// used was capped near 18 MP. 100% is one photo pixel per screen pixel at any size.
test('100% is one photo pixel per screen pixel on a photo larger than 18 MP', async ({ page }) => {
  const root = await importPicture(page, { width: 8256, height: 5504 });
  const percent = root.getByTestId('zoom-percent');
  await percent.click();
  await root.getByTestId('zoom-menu-100').click();
  await expect(percent).toHaveText('100%');
  await page.waitForTimeout(300);
  const box = await pictureBox(page);
  const scale = await page.evaluate(() => window.devicePixelRatio || 1);
  // A Z8-sized 45 MP picture: within a pixel or two of 8,256 photo pixels across, at this screen's pixel ratio.
  expect(Math.abs(box.width * scale - 8256)).toBeLessThanOrEqual(2);
});

// Dave, 27 Nov (installed build): after Zoom to eye, zooming out jumped the view to the photo's bottom-right, and near
// Fit it jumped sideways. Zoomed in near a corner, each step out moves the picture steadily back to where it sits at
// Fit, never jumping, and at Fit the photo is centred.
test('zooming out from near a corner never jumps, and the photo ends centred at Fit', async ({ page }) => {
  const root = await importPicture(page);
  const fit = await pictureBox(page);
  const stage = await page.evaluate(() => (document.querySelector('.inflight-v2 [data-testid="canvas-stage"]') as HTMLElement).getBoundingClientRect().toJSON());
  const corner = { x: Math.round(fit.left + fit.width * 0.85), y: Math.round(fit.top + fit.height * 0.85) };
  await page.mouse.move(corner.x, corner.y);
  await pinch(page, 24, -12);
  void stage;
  const zoomOut = root.getByRole('button', { name: 'Zoom out', exact: true });
  for (let step = 1; step <= 20; step += 1) {
    const before = await pictureBox(page);
    if (before.width <= fit.width + 1) break;
    await zoomOut.click();
    await page.waitForTimeout(150);
    const off = offTowardsFit(fit, before, await pictureBox(page));
    expect(off.x, `step ${step}: the picture jumped sideways by ${off.x.toFixed(1)} px`).toBeLessThanOrEqual(4);
    expect(off.y, `step ${step}: the picture jumped up or down by ${off.y.toFixed(1)} px`).toBeLessThanOrEqual(4);
  }
  await root.getByTestId('zoom-fit').click();
  await page.waitForTimeout(200);
  const end = await pictureBox(page);
  expect(Math.abs(end.left + end.width / 2 - (fit.left + fit.width / 2)), 'Fit is centred across').toBeLessThanOrEqual(2);
  expect(Math.abs(end.top + end.height / 2 - (fit.top + fit.height / 2)), 'Fit is centred up and down').toBeLessThanOrEqual(2);
});

// Headed (as on Windows, where scrollbars take room): the filmstrip's tool row overflowed while an import was finishing,
// its scrollbar came and went, and the canvas changed height by about 10 px, moving Fit. The canvas keeps its size.
test('the canvas keeps its size while an import finishes, so Fit does not move', async ({ page }) => {
  await importPicture(page);
  const height = () => page.evaluate(() => (document.querySelector('.inflight-v2 [data-testid="canvas-stage"]') as HTMLElement).offsetHeight);
  const first = await height();
  await page.waitForTimeout(6000);
  expect(await height(), 'the canvas grew or shrank once the import finished').toBe(first);
});

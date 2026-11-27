import { expect, test, type Page } from '@playwright/test';

// Owner, 27 Nov (Windows laptop touchpad): "Zoom in/out on the canvas jumps around". A touchpad pinch reaches the page
// as Ctrl+wheel; the point of the picture under the fingers must stay under them while it zooms in and back out.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'A touchpad pinch (Ctrl+wheel) is a desktop gesture; touch pinch is in v2-phone-uat.');
});

async function importPicture(page: Page) {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Pinch check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 3000; canvas.height = 2000;
    const ctx = canvas.getContext('2d')!;
    for (let y = 0; y < 20; y += 1) for (let x = 0; x < 30; x += 1) {
      ctx.fillStyle = (x + y) % 2 ? '#6a7a8a' : '#a0886a'; ctx.fillRect(x * 100, y * 100, 100, 100);
    }
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'checks.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1, { timeout: 30000 });
  await expect(root.getByTestId('zoom-percent')).not.toHaveText('100%', { timeout: 30000 });
  return root;
}

/** The picture in the frame, on screen. */
const pictureBox = (page: Page) => page.evaluate(() => {
  const frame = document.querySelector('.inflight-v2 [data-testid="canvas-frame"]')!;
  const pics = [...frame.querySelectorAll('img, canvas')] as HTMLElement[];
  const r = pics.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0].getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
});

/** A touchpad pinch: Ctrl held, many small wheel steps sent as fast as a touchpad does (negative zooms in). */
async function pinch(page: Page, steps: number, deltaY: number) {
  await page.keyboard.down('Control');
  for (let step = 0; step < steps; step += 1) await page.mouse.wheel(0, deltaY);
  await page.keyboard.up('Control');
  await page.waitForTimeout(250);
}

test('a touchpad pinch (Ctrl+wheel) keeps the picture point under the fingers in place, in and back out', async ({ page }) => {
  const root = await importPicture(page);
  const start = await pictureBox(page);
  // A point off the middle of the picture, so a zoom about the centre would visibly move it.
  const at = { x: start.left + start.width * 0.7, y: start.top + start.height * 0.35 };
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
  expect((await pictureBox(page)).width).toBeLessThan(zoomedIn.width / 2);
  expect(await drift(), 'the point under the fingers moved while zooming out').toBeLessThanOrEqual(4);

  // The page itself never zoomed: the browser's own pinch-zoom was held back.
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
  await expect(root.getByTestId('zoom-percent')).not.toHaveText('100%');
});

test('two-finger scroll (a plain wheel without Ctrl) pans the zoomed picture and does not zoom', async ({ page }) => {
  const root = await importPicture(page);
  const at = await pictureBox(page);
  await page.mouse.move(at.left + at.width / 2, at.top + at.height / 2);
  await pinch(page, 24, -12);
  const zoomed = await root.getByTestId('zoom-percent').textContent();
  const before = await pictureBox(page);
  // Small, smooth deltas with a sideways part, as a touchpad's two-finger scroll sends them.
  for (let step = 0; step < 10; step += 1) await page.mouse.wheel(7, 9);
  await page.waitForTimeout(250);
  const after = await pictureBox(page);
  expect(after.width).toBeCloseTo(before.width, 0);
  expect(Math.abs(after.top - before.top) + Math.abs(after.left - before.left)).toBeGreaterThan(20);
  await expect(root.getByTestId('zoom-percent')).toHaveText(zoomed!);
});

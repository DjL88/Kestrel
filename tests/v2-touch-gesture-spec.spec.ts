import { expect, test, type CDPSession, type Page } from '@playwright/test';

// Phone and tablet gestures, set by what Photos, Lightroom and Snapseed do (see the PR for sources): double-tap zooms (Crop on
// double-tap is a choice); a single tap never opens Crop or zooms; pinch in Crop zooms the picture inside the crop window while the window stays put; a long press on a photo in
// the filmstrip or the gallery opens its menu, and scrolling or moving the finger never does. Touch runs in the phone project;
// the keyboard route to the same menu runs in the desktop project.

async function openPhotos(page: Page, count = 3) {
  await page.goto('/?v2');
  const studio = page.locator('.inflight-v2');
  await expect(studio.getByText('No projects yet')).toBeVisible({ timeout: 30_000 });
  await studio.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Gesture spec');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const png = await page.evaluate(() => {
    const image = document.createElement('canvas');
    image.width = 1200;
    image.height = 800;
    const ctx = image.getContext('2d')!;
    ctx.fillStyle = '#586b82';
    ctx.fillRect(0, 0, image.width, image.height);
    ctx.fillStyle = '#d9a441';
    ctx.fillRect(400, 250, 400, 300);
    return image.toDataURL('image/png').split(',')[1];
  });
  const picker = page.waitForEvent('filechooser');
  await studio.getByRole('button', { name: 'Import', exact: true }).click();
  await (await picker).setFiles(Array.from({ length: count }, (_, i) => ({ name: `gesture-${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })));
  await expect(studio.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(count);
  await expect(studio.getByTestId('canvas-frame')).toBeVisible();
  return studio;
}

const touch = (cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', points: Array<{ x: number; y: number; id?: number }>) =>
  cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : points });

async function tap(cdp: CDPSession, x: number, y: number) {
  await touch(cdp, 'touchStart', [{ x, y }]);
  await touch(cdp, 'touchEnd', []);
}

async function centreOf(page: Page, testId: string) {
  const box = (await page.getByTestId(testId).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

async function pinch(cdp: CDPSession, centre: { x: number; y: number }, from: number, to: number) {
  const at = (spread: number) => [{ x: centre.x - spread, y: centre.y, id: 1 }, { x: centre.x + spread, y: centre.y, id: 2 }];
  await touch(cdp, 'touchStart', at(from));
  const steps = 6;
  for (let i = 1; i <= steps; i++) await touch(cdp, 'touchMove', at(from + ((to - from) * i) / steps));
  await touch(cdp, 'touchEnd', []);
}

const DOUBLE_TAP_KEY = 'inflight.v2.gesture.double-tap';
const doubleTap = async (page: Page, cdp: CDPSession, x: number, y: number) => {
  await tap(cdp, x, y);
  await page.waitForTimeout(90);
  await tap(cdp, x, y);
};
const useDoubleTapFor = (page: Page, action: string) => page.addInitScript(([key, value]) => localStorage.setItem(key, value), [DOUBLE_TAP_KEY, action]);

test.describe('phone: canvas and Crop', () => {
  test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'phone', 'Requires the touch-enabled phone project.'); });

  test('a single tap on the photo changes nothing: no Crop, no zoom, bars stay', async ({ page }) => {
    const studio = await openPhotos(page);
    const cdp = await page.context().newCDPSession(page);
    const { x, y } = await centreOf(page, 'canvas-frame');
    const zoomBefore = await page.getByTestId('zoom-percent').innerText();
    await tap(cdp, x, y);
    // Wait past the double-tap window, so a lone tap is known to stay a lone tap.
    await page.waitForTimeout(600);
    await expect(page.getByTestId('crop-ghost')).toHaveCount(0);
    expect(await page.getByTestId('zoom-percent').innerText()).toBe(zoomBefore);
    await expect(studio.getByRole('listbox', { name: 'Project photographs' })).toBeVisible();
  });

  test('double-tap zooms in to 100% and again back to Fit, as in Photos and Lightroom; the page never zooms', async ({ page }) => {
    await openPhotos(page);
    const cdp = await page.context().newCDPSession(page);
    const { x, y } = await centreOf(page, 'canvas-frame');
    const fit = await page.getByTestId('zoom-percent').innerText();
    await doubleTap(page, cdp, x, y);
    await expect.poll(async () => Number((await page.getByTestId('zoom-percent').innerText()).replace('%', ''))).toBe(100);
    // A dblclick that follows the touch does not open Crop on top of it.
    await page.waitForTimeout(700);
    await expect(page.getByTestId('crop-ghost')).toHaveCount(0);
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
    await page.waitForTimeout(400);
    const again = await centreOf(page, 'canvas-frame');
    await doubleTap(page, cdp, Math.min(again.x, 300), Math.min(again.y, 400));
    await expect.poll(() => page.getByTestId('zoom-percent').innerText()).toBe(fit);
  });

  test('two taps far apart are not a double-tap', async ({ page }) => {
    await openPhotos(page);
    const cdp = await page.context().newCDPSession(page);
    const { x, y, box } = await centreOf(page, 'canvas-frame');
    const zoomBefore = await page.getByTestId('zoom-percent').innerText();
    await tap(cdp, x - box.width / 4, y);
    await page.waitForTimeout(90);
    await tap(cdp, x + box.width / 4, y);
    await page.waitForTimeout(500);
    expect(await page.getByTestId('zoom-percent').innerText()).toBe(zoomBefore);
    await expect(page.getByTestId('crop-ghost')).toHaveCount(0);
  });

  test('the double-tap can be set to open Crop instead, even when the browser sends no dblclick', async ({ page }) => {
    await useDoubleTapFor(page, 'crop');
    await openPhotos(page);
    // Swallow every dblclick before the app sees it: the double-tap must be recognised from the touches themselves.
    await page.evaluate(() => window.addEventListener('dblclick', (event) => event.stopImmediatePropagation(), true));
    const cdp = await page.context().newCDPSession(page);
    const { x, y } = await centreOf(page, 'canvas-frame');
    await doubleTap(page, cdp, x, y);
    await expect(page.getByTestId('crop-ghost')).toBeVisible();
    await page.waitForTimeout(400);
    await doubleTap(page, cdp, x, y);
    await expect(page.getByTestId('crop-ghost')).toHaveCount(0);
  });

  test('the double-tap can be switched off', async ({ page }) => {
    await useDoubleTapFor(page, 'off');
    await openPhotos(page);
    const cdp = await page.context().newCDPSession(page);
    const { x, y } = await centreOf(page, 'canvas-frame');
    const zoomBefore = await page.getByTestId('zoom-percent').innerText();
    await doubleTap(page, cdp, x, y);
    await page.waitForTimeout(600);
    expect(await page.getByTestId('zoom-percent').innerText()).toBe(zoomBefore);
    await expect(page.getByTestId('crop-ghost')).toHaveCount(0);
  });

  test('in Crop, pinching zooms the picture inside the crop window and the window stays put', async ({ page }) => {
    await useDoubleTapFor(page, 'crop');
    await openPhotos(page);
    const cdp = await page.context().newCDPSession(page);
    const { x, y } = await centreOf(page, 'canvas-frame');
    await doubleTap(page, cdp, x, y);
    await expect(page.getByTestId('crop-ghost')).toBeVisible();
    const frame = (await page.getByTestId('canvas-frame').boundingBox())!;
    const ghostWidth = async () => (await page.getByTestId('crop-ghost').boundingBox())!.width;
    const start = await ghostWidth();

    await pinch(cdp, { x, y }, 20, 90);
    await expect.poll(ghostWidth).toBeGreaterThan(start * 1.2);
    const zoomedIn = await ghostWidth();
    const frameAfter = (await page.getByTestId('canvas-frame').boundingBox())!;
    expect(Math.abs(frameAfter.width - frame.width)).toBeLessThan(1);
    expect(Math.abs(frameAfter.height - frame.height)).toBeLessThan(1);
    expect(Math.abs(frameAfter.x - frame.x)).toBeLessThan(1);

    await pinch(cdp, { x, y }, 90, 20);
    await expect.poll(ghostWidth).toBeLessThan(zoomedIn * 0.9);
    // The picture never goes below the crop window: zoom bottoms out at 1.
    await pinch(cdp, { x, y }, 90, 5);
    await expect.poll(ghostWidth).toBeGreaterThanOrEqual(start - 1);
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
  });

  test('in Crop with the default double-tap, a double-tap puts the picture back in the crop window', async ({ page }) => {
    await useDoubleTapFor(page, 'crop');
    await openPhotos(page);
    const cdp = await page.context().newCDPSession(page);
    const { x, y } = await centreOf(page, 'canvas-frame');
    await doubleTap(page, cdp, x, y);
    await expect(page.getByTestId('crop-ghost')).toBeVisible();
    const ghostWidth = async () => (await page.getByTestId('crop-ghost').boundingBox())!.width;
    const start = await ghostWidth();
    await pinch(cdp, { x, y }, 20, 90);
    await expect.poll(ghostWidth).toBeGreaterThan(start * 1.2);
    // The preference is read at each double-tap, so switching it to zoom makes the double-tap reset the crop zoom.
    await page.evaluate((key) => localStorage.setItem(key, 'zoom'), DOUBLE_TAP_KEY);
    await page.waitForTimeout(400);
    await doubleTap(page, cdp, x, y);
    await expect.poll(ghostWidth).toBeLessThanOrEqual(start + 1);
    await expect(page.getByTestId('crop-ghost')).toBeVisible();
  });
});

test.describe('phone: long press opens the photo menu', () => {
  test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'phone', 'Requires the touch-enabled phone project.'); });

  test('gallery: a long press opens the menu, a moving finger does not, and every target is 44 px', async ({ page }) => {
    const studio = await openPhotos(page);
    const cdp = await page.context().newCDPSession(page);
    await page.keyboard.press('g');
    const card = studio.locator('article[data-thumb-id]').nth(1);
    await expect(card).toBeVisible();
    const box = (await card.locator('img').boundingBox())!;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    const menu = page.getByTestId('photo-quick-menu');

    // Moving the finger (a scroll) cancels the press: no menu, and the photo is not opened.
    await touch(cdp, 'touchStart', [{ x, y }]);
    await touch(cdp, 'touchMove', [{ x, y: y - 40 }]);
    await page.waitForTimeout(650);
    await touch(cdp, 'touchEnd', []);
    await expect(menu).toHaveCount(0);

    await touch(cdp, 'touchStart', [{ x, y }]);
    await expect(menu).toBeVisible();
    await touch(cdp, 'touchEnd', []);
    // The release of the press neither closes the menu nor opens the photo underneath it.
    await expect(menu).toBeVisible();
    await expect(studio.locator('article[data-thumb-id]')).toHaveCount(3);
    for (const item of await menu.getByRole('button').all()) {
      const size = (await item.boundingBox())!;
      expect(size.height, await item.innerText()).toBeGreaterThanOrEqual(43.5);
      expect(size.width).toBeGreaterThanOrEqual(43.5);
    }
    expect(await menu.boundingBox()).toMatchObject({ x: expect.any(Number) });
    const inside = await menu.evaluate((el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight; });
    expect(inside).toBe(true);

    await menu.getByRole('menuitem', { name: /^Flag$/ }).tap();
    await expect(menu).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Unflag gesture-2.png' })).toBeVisible();

    // Rating from the menu, and choosing it again clears it.
    await card.getByRole('button', { name: /Photo actions: gesture-2\.png/ }).tap();
    await menu.getByRole('menuitemradio', { name: 'Rate 4 stars' }).tap();
    await expect(card.getByLabel('Rating 4 of 5')).toBeVisible();
  });

  test('filmstrip: a long press opens the menu with Auto, and its targets are 44 px', async ({ page }) => {
    const studio = await openPhotos(page);
    const cdp = await page.context().newCDPSession(page);
    const tile = studio.getByRole('listbox', { name: 'Project photographs' }).getByRole('option').nth(1);
    const box = (await tile.boundingBox())!;
    await touch(cdp, 'touchStart', [{ x: box.x + 30, y: box.y + box.height - 10 }]);
    const menu = page.getByRole('menu', { name: 'Photo actions' });
    await expect(menu).toBeVisible();
    await touch(cdp, 'touchEnd', []);
    await expect(menu.getByRole('menuitem', { name: 'Auto' })).toBeVisible();
    for (const item of await menu.getByRole('menuitem').all()) {
      expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    }
  });
});

test.describe('keyboard parity', () => {
  test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'The keyboard route runs in the desktop project.'); });

  for (const chord of ['Shift+F10', 'ContextMenu']) {
    test(`gallery: ${chord} on a focused photo opens its menu; arrows move; Escape returns focus`, async ({ page }) => {
      const studio = await openPhotos(page);
      await page.keyboard.press('g');
      const card = studio.locator('article[data-thumb-id]').nth(1);
      const open = card.locator('button').first();
      await open.focus();
      await page.keyboard.press(chord);
      const menu = page.getByTestId('photo-quick-menu');
      await expect(menu).toBeVisible();
      const items = menu.getByRole('menuitem');
      await expect(items.first()).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(items.nth(1)).toBeFocused();
      await page.keyboard.press('End');
      await expect(menu.getByRole('menuitemradio').last()).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(open).toBeFocused();
    });
  }

  test('gallery: Enter on a menu item runs it', async ({ page }) => {
    const studio = await openPhotos(page);
    await page.keyboard.press('g');
    const card = studio.locator('article[data-thumb-id]').nth(0);
    await card.locator('button').first().focus();
    await page.keyboard.press('Shift+F10');
    const menu = page.getByTestId('photo-quick-menu');
    await menu.getByRole('menuitem', { name: 'Flag' }).focus();
    await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Unflag gesture-1.png' })).toBeVisible();
  });
});

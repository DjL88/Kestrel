import { expect, test, type CDPSession, type Page } from '@playwright/test';

// The owner's phone and tablet gesture spec (CLAUDE.md, 28 Nov): double-tap opens Crop; a single tap never opens it or hides
// the bars; pinch in Crop zooms the picture inside the crop window while the window stays put; a long press on a photo in
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

test.describe('phone: canvas and Crop', () => {
  test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'phone', 'Requires the touch-enabled phone project.'); });

  test('a single tap on the photo changes nothing: no Crop, bars stay', async ({ page }) => {
    const studio = await openPhotos(page);
    const cdp = await page.context().newCDPSession(page);
    const { x, y } = await centreOf(page, 'canvas-frame');
    await tap(cdp, x, y);
    // Wait past the double-tap window, so a lone tap is known to stay a lone tap.
    await page.waitForTimeout(600);
    await expect(page.getByTestId('crop-ghost')).toHaveCount(0);
    await expect(studio.getByRole('listbox', { name: 'Project photographs' })).toBeVisible();
    await expect(page.getByTestId('canvas-frame')).toBeVisible();
  });

  test('double-tap opens Crop and again leaves it, without the page or the picture zooming', async ({ page }) => {
    await openPhotos(page);
    const cdp = await page.context().newCDPSession(page);
    const { x, y } = await centreOf(page, 'canvas-frame');
    const zoomBefore = await page.getByTestId('zoom-percent').innerText();
    await tap(cdp, x, y);
    await page.waitForTimeout(90);
    await tap(cdp, x, y);
    await expect(page.getByTestId('crop-ghost')).toBeVisible();
    // The native double-tap-to-zoom never takes it, and a dblclick after the touch does not toggle it back.
    await page.waitForTimeout(700);
    await expect(page.getByTestId('crop-ghost')).toBeVisible();
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
    expect(await page.getByTestId('zoom-percent').innerText()).toBe(zoomBefore);
    await page.waitForTimeout(400);
    await tap(cdp, x, y);
    await page.waitForTimeout(90);
    await tap(cdp, x, y);
    await expect(page.getByTestId('crop-ghost')).toHaveCount(0);
  });

  test('double-tap opens Crop even when the browser sends no dblclick (iOS and Android WebViews often do not)', async ({ page }) => {
    await openPhotos(page);
    // Swallow every dblclick before the app sees it: the double-tap must be recognised from the touches themselves.
    await page.evaluate(() => window.addEventListener('dblclick', (event) => event.stopImmediatePropagation(), true));
    const cdp = await page.context().newCDPSession(page);
    const { x, y } = await centreOf(page, 'canvas-frame');
    await tap(cdp, x, y);
    await page.waitForTimeout(90);
    await tap(cdp, x, y);
    await expect(page.getByTestId('crop-ghost')).toBeVisible();
    await page.waitForTimeout(400);
    await tap(cdp, x, y);
    await page.waitForTimeout(90);
    await tap(cdp, x, y);
    await expect(page.getByTestId('crop-ghost')).toHaveCount(0);
  });

  test('two taps far apart, or a drag between them, are not a double-tap', async ({ page }) => {
    await openPhotos(page);
    const cdp = await page.context().newCDPSession(page);
    const { x, y, box } = await centreOf(page, 'canvas-frame');
    await tap(cdp, x - box.width / 4, y);
    await page.waitForTimeout(90);
    await tap(cdp, x + box.width / 4, y);
    await page.waitForTimeout(500);
    await expect(page.getByTestId('crop-ghost')).toHaveCount(0);
  });

  test('in Crop, pinching zooms the picture inside the crop window and the window stays put', async ({ page }) => {
    await openPhotos(page);
    const cdp = await page.context().newCDPSession(page);
    const { x, y } = await centreOf(page, 'canvas-frame');
    await tap(cdp, x, y);
    await page.waitForTimeout(90);
    await tap(cdp, x, y);
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

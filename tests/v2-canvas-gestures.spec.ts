import { expect, test, type Page } from '@playwright/test';

// The canvas must take pinch and pan itself, wherever the gesture starts over it, and never let the page zoom the studio's
// menus. It must also fit the photo to the real stage. Both used to fail whenever a project was opened before a photo
// was chosen: the canvas mounted with no photo, so its listeners and size observer were never attached.

async function openPhoto(page: Page) {
  await page.goto('/?v2');
  const studio = page.locator('.inflight-v2');
  await expect(studio.getByText('No projects yet')).toBeVisible();
  await studio.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Gestures');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const png = await page.evaluate(() => {
    const image = document.createElement('canvas');
    image.width = 1200;
    image.height = 800;
    const ctx = image.getContext('2d')!;
    ctx.fillStyle = '#586b82';
    ctx.fillRect(0, 0, image.width, image.height);
    return image.toDataURL('image/png').split(',')[1];
  });
  const picker = page.waitForEvent('filechooser');
  await studio.getByRole('button', { name: 'Import', exact: true }).click();
  await (await picker).setFiles([{ name: 'gesture-test.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
  await expect(studio.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  await expect(studio.getByTestId('canvas-frame')).toBeVisible();
  return studio;
}

const zoomPercent = async (page: Page) => Number((await page.getByTestId('zoom-percent').innerText()).replace('%', ''));

test('Fit keeps the whole photo inside the stage on every screen', async ({ page }) => {
  await openPhoto(page);
  const stage = (await page.getByTestId('canvas-stage').boundingBox())!;
  const frame = (await page.getByTestId('canvas-frame').boundingBox())!;
  expect(frame.x).toBeGreaterThanOrEqual(stage.x - 1);
  expect(frame.x + frame.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
  expect(frame.y + frame.height).toBeLessThanOrEqual(stage.y + stage.height + 1);
});

test('a trackpad pinch anywhere over the canvas zooms the photo, not the page', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Trackpad pinch (Ctrl+wheel) is a desktop gesture.');
  await openPhoto(page);
  const stage = (await page.getByTestId('canvas-stage').boundingBox())!;
  const before = await zoomPercent(page);
  // Report whether the browser would still have zoomed the page.
  await page.evaluate(() => {
    (window as unknown as { pageZoomAllowed: number }).pageZoomAllowed = 0;
    window.addEventListener('wheel', (event) => { if (event.ctrlKey && !event.defaultPrevented) (window as unknown as { pageZoomAllowed: number }).pageZoomAllowed += 1; });
  });
  // In the empty margin round the photo.
  await page.mouse.move(stage.x + 12, stage.y + stage.height - 12);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  await expect.poll(() => zoomPercent(page)).toBeGreaterThan(before);
  const afterMargin = await zoomPercent(page);
  // Over the bar above the stage, buttons included.
  const bar = (await page.getByRole('button', { name: 'Zoom in' }).boundingBox())!;
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  await expect.poll(() => zoomPercent(page)).toBeGreaterThan(afterMargin);
  expect(await page.evaluate(() => (window as unknown as { pageZoomAllowed: number }).pageZoomAllowed)).toBe(0);
});

test('a mouse drag on the empty stage moves round a zoomed-in photo', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Mouse gesture.');
  await openPhoto(page);
  for (let i = 0; i < 4; i += 1) await page.getByRole('button', { name: 'Zoom in' }).click();
  const stage = page.getByTestId('canvas-stage');
  await expect.poll(() => stage.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await stage.evaluate((el) => { el.scrollLeft = 200; el.scrollTop = 0; });
  const box = (await stage.boundingBox())!;
  // The top edge of the stage is margin above the photo at this zoom.
  const startX = box.x + box.width / 2;
  const startY = box.y + 6;
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid="canvas-frame"]') === null, [startX, startY])).toBe(true);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 120, startY, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => stage.evaluate((el) => el.scrollLeft)).toBe(80);
});

test('a two-finger pinch that starts in the margin zooms the photo and never the page', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Requires the touch-enabled phone project.');
  const studio = await openPhoto(page);
  const stage = (await page.getByTestId('canvas-stage').boundingBox())!;
  const frame = (await page.getByTestId('canvas-frame').boundingBox())!;
  const before = await zoomPercent(page);
  const cdp = await page.context().newCDPSession(page);
  // One finger on the photo, the other in the empty margin below its left side (clear of the zoom buttons).
  const a = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
  const b = { x: stage.x + 12, y: Math.min(stage.y + stage.height - 60, frame.y + frame.height + 24) };
  expect(b.y).toBeGreaterThan(frame.y + frame.height);
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.getAttribute('data-testid'), [b.x, b.y])).toBe('canvas-stage');
  const points = (spread: number) => [
    { x: a.x + spread, y: a.y - spread, id: 1 },
    { x: Math.max(stage.x + 2, b.x - spread / 4), y: b.y + spread / 2, id: 2 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(0) });
  for (const spread of [10, 20, 30, 40]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(spread) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => zoomPercent(page)).toBeGreaterThan(before);
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
  // The studio's own bars and panels never offer the browser a pinch zoom either.
  expect(await studio.evaluate((el) => getComputedStyle(el).touchAction)).toBe('pan-x pan-y');
  expect(await page.getByTestId('canvas-stage').evaluate((el) => getComputedStyle(el).touchAction)).toBe('none');
});

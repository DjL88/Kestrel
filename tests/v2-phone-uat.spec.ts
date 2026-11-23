import { expect, test, type Page } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Requires the touch-enabled phone project.');
});

async function importPhoto(page: Page) {
  await page.goto('/?v2');
  const studio = page.locator('.inflight-v2');
  await expect(studio.getByText('No projects yet')).toBeVisible();
  await studio.getByRole('button', { name: 'New project' }).first().tap();
  await page.getByLabel('Project name', { exact: true }).fill('Phone acceptance');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().tap();
  const png = await page.evaluate(() => {
    const image = document.createElement('canvas');
    image.width = 240;
    image.height = 160;
    const ctx = image.getContext('2d')!;
    ctx.fillStyle = '#586b82';
    ctx.fillRect(0, 0, image.width, image.height);
    return image.toDataURL('image/png').split(',')[1];
  });
  const picker = page.waitForEvent('filechooser');
  await studio.getByRole('button', { name: 'Import', exact: true }).tap();
  await (await picker).setFiles([{ name: 'phone-test.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
  await expect(studio.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  return studio;
}

test('320px phone can undo and redo an offline edit by touch', async ({ page, context }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const studio = await importPhoto(page);
  const tools = studio.getByRole('navigation', { name: 'Mobile studio tools' });
  const header = studio.getByRole('banner', { name: 'InFlight studio header' });
  await expect(tools.getByRole('button', { name: 'Overlays' })).toHaveCount(0);
  if (!(await studio.getByRole('tab', { name: 'Advanced Edits' }).isVisible())) {
    await tools.getByRole('button', { name: 'Adjust' }).tap();
  }
  await studio.getByRole('tab', { name: 'Advanced Edits' }).tap();
  const exposure = studio.getByRole('slider', { name: 'Exposure' });
  const undo = header.getByRole('button', { name: 'Undo' });
  const redo = header.getByRole('button', { name: 'Redo' });
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  await context.setOffline(true);
  await exposure.fill('1');
  await expect(exposure).toHaveValue('1');
  await undo.tap();
  await expect(exposure).toHaveValue('0');
  await redo.tap();
  await expect(exposure).toHaveValue('1');
  await expect(header.getByRole('button', { name: 'Export', exact: true })).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test('canvas frame only blocks touch scrolling while a photo pinch/pan gesture can run there', async ({ page }) => {
  // Regression guard for the fix in src/v2/ui/shell/Canvas.tsx that scopes touchAction: 'none' to
  // `activeSize.kind === 'photo' && !compareMode` — previously it was applied unconditionally, which
  // blocked the surrounding page from scrolling even in modes (like before/after compare) where no
  // photo pinch/pan gesture can start on the frame at all.
  await page.setViewportSize({ width: 390, height: 844 });
  const studio = await importPhoto(page);
  const frame = studio.getByTestId('canvas-frame');
  await expect(frame).toHaveCSS('touch-action', 'none');
  await studio.getByRole('button', { name: 'Compare before & after' }).tap();
  await expect(frame).toHaveCSS('touch-action', 'auto');
});

for (const viewport of [{ width: 320, height: 568 }, { width: 667, height: 375 }]) {
  test(`Export controls stay reachable at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const studio = await importPhoto(page);
    await studio.getByRole('banner').getByRole('button', { name: 'Export', exact: true }).tap();
    const dialog = studio.getByRole('dialog', { name: 'Export & Share' });
    const close = dialog.getByRole('button', { name: 'Close export dialog' });
    const submit = dialog.getByRole('button', { name: 'Export bundle' });
    await expect(close).toBeInViewport({ ratio: 1 });
    await expect(submit).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole('button', { name: /Dropbox|Google Drive|Local NAS/ })).toHaveCount(0);
    const before = dialog.getByRole('button', { name: /Before: unedited, developed/ });
    await before.tap();
    await expect(before).toHaveAttribute('aria-pressed', 'true');
    await expect(submit).toBeInViewport({ ratio: 1 });
    await close.tap();
    await expect(dialog).toHaveCount(0);
  });
}

test('a swipe down on the tool sheet header closes it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const studio = await importPhoto(page);
  const tools = studio.getByRole('navigation', { name: 'Mobile studio tools' });
  await tools.getByRole('button', { name: 'Adjust' }).tap();
  const handle = page.getByTestId('mobile-sheet-handle');
  await expect(handle).toBeVisible();
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 120, { steps: 6 });
  await page.mouse.up();
  await expect(handle).toHaveCount(0);
});

test('press and hold the photo shows the original; letting go shows the edit again; a drag still pans', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const studio = await importPhoto(page);
  const frame = studio.getByTestId('canvas-frame');
  await expect(frame).toBeVisible();
  const box = (await frame.boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const cdp = await context.newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', px = x, py = y) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: px, y: py }] });
  await touch('touchStart');
  await page.waitForTimeout(700);
  await expect(studio.getByRole('status').filter({ hasText: 'Showing the original' })).toBeVisible();
  await touch('touchEnd');
  await expect(studio.getByRole('status').filter({ hasText: 'Showing the original' })).toHaveCount(0);
  // A quick touch that moves is a drag, not a hold.
  await touch('touchStart');
  await touch('touchMove', x + 30, y + 10);
  await page.waitForTimeout(700);
  await expect(studio.getByRole('status').filter({ hasText: 'Showing the original' })).toHaveCount(0);
  await touch('touchEnd');
});

test('swipe on the photo: left or right steps through photos, up or down through formats; a pinch-free flick only', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?v2');
  const studio = page.locator('.inflight-v2');
  await expect(studio.getByText('No projects yet')).toBeVisible();
  await studio.getByRole('button', { name: 'New project' }).first().tap();
  await page.getByLabel('Project name', { exact: true }).fill('Swipe');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().tap();
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 240; c.height = 160;
    c.getContext('2d')!.fillRect(0, 0, 240, 160);
    return c.toDataURL('image/png').split(',')[1];
  });
  const picker = page.waitForEvent('filechooser');
  await studio.getByRole('button', { name: 'Import', exact: true }).tap();
  await (await picker).setFiles(['swipe-a.png', 'swipe-b.png', 'swipe-c.png'].map((name) => ({ name, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })));
  const options = studio.getByRole('listbox', { name: 'Project photographs' }).getByRole('option');
  await expect(options).toHaveCount(3);
  const frame = studio.getByTestId('canvas-frame');
  await expect(frame).toBeVisible();
  const box = (await frame.boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const cdp = await context.newCDPSession(page);
  const flick = async (dx: number, dy: number) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
    for (const step of [0.25, 0.5, 0.75, 1]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + dx * step, y: cy + dy * step }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(700);
  };
  const selectedName = async () => ((await options.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-selected')))).indexOf('true'));
  await flick(-110, 0); // the first photo is active before anything is selected
  await expect.poll(selectedName).toBe(1);
  await flick(-110, 0);
  await expect.poll(selectedName).toBe(2);
  await flick(-110, 0); // the last photo: no wrap
  await expect.poll(selectedName).toBe(2);
  await flick(110, 0);
  await expect.poll(selectedName).toBe(1);
  // A short or slanted drag is not a swipe.
  await flick(-30, 0);
  await expect.poll(selectedName).toBe(1);
  await flick(-100, 90);
  await expect.poll(selectedName).toBe(1);
  // Up and down change the format, not the photo.
  const label = async () => ((await studio.getByTestId('canvas-frame').locator('xpath=../../div[1]/span[1]').textContent()) ?? '').trim();
  const before = await label();
  await flick(0, -110);
  await expect.poll(label).not.toBe(before);
  await expect.poll(selectedName).toBe(1);
  await flick(0, 110);
  await expect.poll(label).toBe(before);
});

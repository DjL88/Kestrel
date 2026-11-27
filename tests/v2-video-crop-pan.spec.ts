import { expect, test, type Locator, type Page } from '@playwright/test';

// Dave, 27 Nov (installed build): in Crop on the Video (Zoom MP4) 9:16 format the picture could not be moved, and the
// orange "Zoom in · 6s" target sat in the middle of the frame. In Crop a drag anywhere in the frame positions the
// picture, in every format, and the video's zoom target is not drawn until Crop closes.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Mouse drags on the desktop canvas; touch uses the same handler.');
});

/** The picture inside the frame, on screen (it moves when the crop's pan changes). */
const pictureLeftTop = (page: Page) => page.evaluate(() => {
  const frame = document.querySelector('.inflight-v2 [data-testid="canvas-frame"]')!;
  const clip = frame.querySelector('[data-testid="image-inset-clip"]')!;
  const picture = (clip.firstElementChild ?? clip) as HTMLElement;
  const r = picture.getBoundingClientRect(); const f = frame.getBoundingClientRect();
  return { x: r.left - f.left, y: r.top - f.top };
});

async function show(root: Locator, label: string) {
  const tab = root.getByRole('button', { name: 'Formats', exact: true }).first();
  if ((await tab.getAttribute('aria-pressed')) !== 'true') await tab.click();
  const include = root.getByRole('button', { name: `Include ${label}`, exact: true });
  if (await include.count() && (await include.getAttribute('aria-pressed')) !== 'true') await include.click();
  const showIt = root.getByRole('button', { name: `${label}: included; tap to show it`, exact: true });
  if (await showIt.count()) await showIt.click();
  await expect(root.getByRole('button', { name: `${label}: shown; tap to leave it out of export`, exact: true })).toBeVisible();
}

async function dragInFrame(page: Page, frame: Locator, dx: number, dy: number) {
  const box = (await frame.boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 });
  await page.mouse.up();
}

test('?v2 Crop on the video format: a drag moves the picture, and the zoom target is gone until Crop closes', async ({ page }) => {
  await page.goto('/?v2&stub=1&autostart=1');
  const root = page.locator('.inflight-v2');
  const frame = root.getByTestId('canvas-frame');
  await show(root, 'Video (Zoom MP4)');
  const target = root.getByTestId('video-zoom-target');
  await expect(target, 'outside Crop the video format shows its own zoom target').toBeVisible();

  await root.getByRole('button', { name: 'Crop / reposition' }).click();
  await expect(root.getByTestId('crop-ghost')).toBeVisible();
  await expect(target, 'no zoom target while cropping').toHaveCount(0);

  // Zoomed in a little, so there is room to move in both directions.
  const corner = root.getByRole('button', { name: 'Drag top left crop corner' });
  const c = (await corner.boundingBox())!;
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  await page.mouse.down();
  await page.mouse.move(c.x - 80, c.y - 80, { steps: 6 });
  await page.mouse.up();

  const before = await pictureLeftTop(page);
  await dragInFrame(page, frame, -40, 30);
  const after = await pictureLeftTop(page);
  expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y), 'the picture moved with the drag').toBeGreaterThan(10);
  await expect(target, 'the drag did not drop a zoom target').toHaveCount(0);

  // The other way in, a double-click on the format's card on All formats, behaves the same.
  await page.keyboard.press('Enter');
  await root.getByRole('button', { name: /All formats/ }).click();
  await root.getByTestId('artboard-video-zoom-0').getByRole('button', { name: /Select/ }).dblclick();
  await expect(root.getByTestId('crop-ghost')).toBeVisible();
  await expect(target).toHaveCount(0);
  const again = await pictureLeftTop(page);
  await dragInFrame(page, frame, 30, -20);
  const moved = await pictureLeftTop(page);
  expect(Math.abs(moved.x - again.x) + Math.abs(moved.y - again.y), 'the picture moved after a double-click into Crop').toBeGreaterThan(10);

  // Crop closes: the target is back, where it was.
  await page.keyboard.press('Enter');
  await expect(root.getByTestId('crop-ghost')).toHaveCount(0);
  await expect(target).toBeVisible();
});

for (const label of ['Instagram / TikTok Story', 'Instagram Portrait', 'Instagram Square']) {
  test(`?v2 Crop on ${label}: a drag in the frame moves the picture`, async ({ page }) => {
    await page.goto('/?v2&stub=1&autostart=1');
    const root = page.locator('.inflight-v2');
    const frame = root.getByTestId('canvas-frame');
    await show(root, label);
    await root.getByRole('button', { name: 'Crop / reposition' }).click();
    await expect(root.getByTestId('crop-ghost')).toBeVisible();
    const before = await pictureLeftTop(page);
    // These crop a wide picture to a narrower frame, so there is room to move it sideways.
    await dragInFrame(page, frame, -40, 0);
    const after = await pictureLeftTop(page);
    expect(Math.abs(after.x - before.x), 'the picture moved sideways with the drag').toBeGreaterThan(10);
  });
}

import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * G02: a format shows the same framing in the single view and on the All formats board, on desktop and phone. The
 * picture's transform is compared as a share of its frame (the two views draw the frame at different screen sizes).
 * The export side of the same geometry is proved in src/v2/engineClient/frameGeometry.test.ts.
 */

interface Placement { a: number; b: number; c: number; d: number; e: number; f: number; clip: string }

async function placement(frame: Locator): Promise<Placement> {
  return frame.evaluate((clipBox) => {
    const picture = clipBox.querySelector('img, canvas') as HTMLElement;
    const m = new DOMMatrix(getComputedStyle(picture).transform);
    const box = clipBox.getBoundingClientRect();
    // Translation as a share of the frame; the scale and rotation part does not depend on screen size.
    return { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e / box.width, f: m.f / box.height, clip: getComputedStyle(clipBox).clipPath };
  });
}

function expectSame(single: Placement, board: Placement) {
  for (const key of ['a', 'b', 'c', 'd', 'e', 'f'] as const) expect(Math.abs(single[key] - board[key]), key).toBeLessThan(0.01);
  expect(board.clip).toBe(single.clip);
}

async function openFormats(page: Page, root: Locator) {
  await root.getByRole('button', { name: 'Formats', exact: true }).first().click();
  await expect(page.locator('#format-zoom-slider')).toBeVisible();
}

test('a zoomed, flipped and turned format is framed the same in the single view and on the All formats board', async ({ page }) => {
  await page.goto('/?v2&stub=1&autostart=1');
  const root = page.locator('.inflight-v2');
  await openFormats(page, root);
  await page.locator('#format-zoom-slider').fill('2');
  const close = root.getByRole('button', { name: 'Close Formats panel' });
  if (await close.isVisible()) await close.click();

  const singleFrame = root.getByTestId('canvas-frame').getByTestId('image-inset-clip').first();
  await expect(singleFrame).toBeVisible();
  const single = await placement(singleFrame);
  expect(Math.hypot(single.a, single.b)).toBeGreaterThan(1.9); // the zoom is applied

  await root.getByRole('button', { name: /All formats/ }).click();
  const tile = root.getByTestId('format-pair-orig-3x2');
  await expect(tile).toBeVisible();
  expectSame(single, await placement(tile.getByTestId('image-inset-clip').first()));

  // Flip and turn on the board, then check the single view agrees.
  await tile.getByRole('button', { name: /Select/ }).click();
  await root.getByRole('button', { name: 'Flip selected formats' }).click();
  await root.getByRole('button', { name: 'Rotate selected formats' }).click();
  const board = await placement(tile.getByTestId('image-inset-clip').first());
  expect(board.a * board.d - board.b * board.c).toBeLessThan(0); // mirrored
  await tile.getByRole('button', { name: /Select/ }).dblclick();
  await expect(root.getByTestId('canvas-frame')).toBeVisible();
  expectSame(await placement(root.getByTestId('canvas-frame').getByTestId('image-inset-clip').first()), board);
});

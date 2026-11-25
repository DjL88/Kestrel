import { expect, test } from '@playwright/test';

// Owner request (25 Nov): phone and tablet layouts place things for a finger, and hide what only a mouse can use.
test('?v2 on a touch phone: one row of photo tools, a pinch-friendly zoom bar, and named icon-only buttons', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Phone layout.');
  await page.goto('/?v2&stub=1&autostart=1');
  const root = page.locator('.inflight-v2');
  const bar = root.locator('.v2-canvas-bar');
  await expect(bar).toBeVisible();

  // The view switch and the format actions share one row.
  const single = bar.getByRole('button', { name: 'Single' });
  const crop = bar.getByRole('button', { name: 'Crop / reposition' });
  await expect(single).toBeVisible();
  const [a, b] = [(await single.boundingBox())!, (await crop.boundingBox())!];
  expect(Math.abs((a.y + a.height / 2) - (b.y + b.height / 2))).toBeLessThan(6);
  await expect(root.getByTestId('selected-format-count')).toBeHidden();

  // Pinch zooms, so the zoom bar has no zoom steps or drag grip, and its buttons are finger-sized.
  const zoomBar = root.getByTestId('canvas-viewport-controls');
  await expect(zoomBar.getByRole('button', { name: 'Zoom in' })).toBeHidden();
  await expect(zoomBar.getByTestId('zoom-bar-grip')).toBeHidden();
  const fit = (await zoomBar.getByTestId('zoom-percent').boundingBox())!;
  expect(fit.height).toBeGreaterThanOrEqual(40);

  // Import and Folder show icons but keep their names.
  await expect(root.getByRole('button', { name: 'Import', exact: true })).toBeVisible();
  const importBox = (await root.getByRole('button', { name: 'Import', exact: true }).boundingBox())!;
  expect(importBox.width).toBeLessThan(60);
  expect(importBox.height).toBeGreaterThanOrEqual(40);
});

test('?v2 on an upright tablet: the photo tools fit one row and the mouse-only crop hint is gone', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto('/?v2&stub=1&autostart=1');
  const root = page.locator('.inflight-v2');
  const bar = root.locator('.v2-canvas-bar');
  await expect(bar).toBeVisible();
  const height = await bar.evaluate((el) => el.getBoundingClientRect().height);
  expect(height).toBeLessThan(56);
  await expect(bar.getByRole('button', { name: 'Delete selected format' })).toBeInViewport();
  await expect(root.getByText(/Drag a corner or edge to crop/)).toBeHidden();
  await context.close();
});

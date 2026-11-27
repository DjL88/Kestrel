import { expect, test, type Page } from '@playwright/test';

// Dave, 27 Nov: no permanent hint on the canvas; a short, correct tip only now and then (the first few times the editor
// opens, or Crop starts), dismissible, never over the photo, and View › Show canvas tips brings it back.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'View › Show canvas tips is in the desktop menu bar.');
});

const overlaps = async (page: Page, a: string, b: string) => {
  const [x, y] = [(await page.getByTestId(a).boundingBox())!, (await page.getByTestId(b).boundingBox())!];
  return x.x < y.x + y.width && x.x + x.width > y.x && x.y < y.y + y.height && x.y + x.height > y.y;
};

test('?v2 the canvas tip shows the first three times, under the photo, and View › Show canvas tips brings it back', async ({ page }) => {
  await page.goto('/?v2&stub=1&autostart=1');
  const root = page.locator('.inflight-v2');
  const tip = root.getByTestId('canvas-tip');
  await expect(tip).toContainText('Double-click the photo to crop it.');
  await expect(tip).not.toContainText(/Drag a corner|Drag to move the format/);
  expect(await overlaps(page, 'canvas-tip', 'canvas-stage'), 'the tip covers the photo').toBe(false);
  await tip.getByRole('button', { name: /Dismiss/ }).click();
  await expect(tip).toHaveCount(0);
  // No hover tooltip on the photo talking about cropping.
  await expect(root.getByTestId('canvas-frame').first()).not.toHaveAttribute('title', /crop/i);

  // Shown three times in all, then it stays away.
  for (let visit = 2; visit <= 3; visit += 1) {
    await page.reload();
    await expect(root.getByTestId('canvas-tip'), `visit ${visit}`).toBeVisible();
  }
  await page.reload();
  await expect(root.getByTestId('canvas-frame').first()).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(root.getByTestId('canvas-tip')).toHaveCount(0);

  // View › Show canvas tips brings it back at once.
  await root.getByRole('button', { name: 'View', exact: true }).click();
  await root.getByRole('menuitem', { name: 'Show canvas tips' }).click();
  await expect(root.getByTestId('canvas-tip')).toContainText('Double-click the photo to crop it.');

  // Starting Crop gives the crop tip; finishing it takes the tip away.
  await root.getByTestId('canvas-frame').first().dblclick();
  await expect(root.getByTestId('canvas-tip')).toContainText('Drag the photo to place it.');
  await page.keyboard.press('Escape');
  await expect(root.getByTestId('canvas-tip')).toHaveCount(0);
});

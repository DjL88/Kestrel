import { expect, test } from '@playwright/test';

// Phone edit screen (V2-WORKSPACE 26.3, owner wireframe "Phone · Edit"): the photo's name and place in the top bar
// instead of the logo, and a slimmer strip of small thumbnails instead of tall cards. Nothing becomes unreachable: More
// and Flag stay drawn and tappable on every thumbnail (v2-filmstrip-touch relies on them).
test('phone edit screen: name and place in the top bar, a thin filmstrip, every tile action still reachable', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Phone layout only.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?v2&stub=1');
  const studio = page.locator('.inflight-v2');
  // On a phone the whole project card opens the studio.
  await studio.getByRole('button', { name: 'Cairngorms Pinewood Stags', exact: true }).click();

  const title = studio.getByTestId('phone-photo-title');
  await expect(title).toBeVisible();
  await expect(title).toContainText(/1 of \d+/);
  // Sharing with other people is paused, and the demo is signed out: no Share and no Store in the cloud button.
  await expect(studio.getByTestId('share-button')).toHaveCount(0);
  await expect(studio.getByTestId('store-cloud-button')).toHaveCount(0);

  const strip = studio.getByRole('listbox', { name: 'Project photographs' });
  const firstTile = strip.getByRole('option').first();
  const tile = await firstTile.boundingBox();
  expect(tile!.width).toBeLessThanOrEqual(88);
  expect(tile!.height).toBeLessThanOrEqual(110);
  // Flag and More stay drawn and tappable.
  await expect(firstTile.getByRole('button', { name: /^(Flag|Unflag) / })).toBeVisible();
  await expect(firstTile.getByRole('button', { name: /^More actions for / })).toBeVisible();
  // The filename is not drawn, but the photo button still names the photo.
  expect((await firstTile.getByText(/\.ARW$/).boundingBox())!.width).toBeLessThanOrEqual(1);
  // A state other than Ready is still written on the thumbnail.
  await expect(strip.getByText('Original unavailable').first()).toBeVisible();
});

test('desktop keeps the logo and the filmstrip cards', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop layout only.');
  await page.goto('/?v2&stub=1');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: /Open studio/ }).first().click();
  await expect(studio.getByTestId('phone-photo-title')).toBeHidden();
  await expect(studio.getByTestId('share-button')).toHaveCount(0);
  const tile = await studio.getByRole('listbox', { name: 'Project photographs' }).getByRole('option').first().boundingBox();
  expect(tile!.width).toBeGreaterThan(120);
});

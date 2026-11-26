import { expect, test } from '@playwright/test';

// Owner-approved layout job (A): turning a phone keeps the open tool, the selected photo and the zoom. Before, the
// layout's media-query change handlers closed the open tool on every turn.
test('turning a phone sideways and back keeps the open tool, the selected photo and the zoom', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Turning is a phone gesture.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?v2&stub=1');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: 'Cairngorms Pinewood Stags', exact: true }).click();

  // Choose the second photo, zoom to 100% and open Adjust.
  const photos = studio.getByRole('listbox', { name: 'Project photographs' }).getByRole('option');
  await photos.nth(1).getByRole('button').nth(1).click();
  await expect(photos.nth(1)).toHaveAttribute('aria-selected', 'true');
  const zoom = studio.getByTestId('zoom-percent');
  await zoom.click();
  await page.getByRole('menuitem', { name: /100%/ }).click();
  await expect(zoom).toHaveText('100%');
  await studio.getByRole('navigation', { name: 'Mobile studio tools' }).getByRole('button', { name: 'Adjust', exact: true }).click();
  await expect(studio.getByRole('heading', { name: 'Adjust', level: 2 })).toBeVisible();

  // Sideways: the same tool is open (now docked beside the photo), the same photo is chosen, the zoom is kept.
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(studio.getByRole('button', { name: /^Adjust/, pressed: true }).first()).toBeVisible();
  await expect(zoom).toHaveText('100%');
  // Sideways the open tool is a side panel and the filmstrip steps aside for it, so the chosen photo is checked once
  // the phone is upright again (below).

  // Upright again: still Adjust, still that photo, still 100%.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(studio.getByRole('heading', { name: 'Adjust', level: 2 })).toBeVisible();
  await expect(studio.getByRole('navigation', { name: 'Mobile studio tools' }).getByRole('button', { name: 'Adjust', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(zoom).toHaveText('100%');
  // The filmstrip steps aside while a tool sheet is open on a phone; the top bar still says which photo this is.
  await expect(studio.getByTestId('phone-photo-title')).toContainText(/(^|[^0-9])2 of [0-9]+/);
});

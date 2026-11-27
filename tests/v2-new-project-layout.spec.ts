import { expect, test } from '@playwright/test';

// Dave, 27 Nov: in "Create new project", Photo shoot is the main choice, a full-width card on its own row; Collage or
// album and Tethered shoot share the row below, 50/50; the dialog is wide enough on a 1366×768 laptop to need little or
// no scrolling; a phone stacks the cards.
async function openCreate(page: import('@playwright/test').Page) {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('project-kind-photography')).toBeVisible();
  return dialog;
}

test('Create new project: Photo shoot full width first, the other two side by side, wide enough on a laptop', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The laptop layout; the phone has its own test below.');
  await page.setViewportSize({ width: 1366, height: 768 });
  const dialog = await openCreate(page);
  const box = async (kind: string) => (await dialog.getByTestId(`project-kind-${kind}`).boundingBox())!;
  const [photo, collage, tethered] = [await box('photography'), await box('collage'), await box('tethered')];
  const form = (await dialog.locator('form').first().boundingBox())!;
  expect(form.width, 'the dialog is wider than the old 448 px').toBeGreaterThan(800);
  // Photo shoot spans the row; the other two share the next row, about half each.
  expect(Math.abs(photo.width - (collage.width + tethered.width)), 'Photo shoot spans both columns').toBeLessThan(24);
  expect(collage.y).toBeGreaterThan(photo.y + photo.height - 2);
  expect(Math.abs(collage.y - tethered.y), 'Collage and Tethered on the same row').toBeLessThan(2);
  expect(Math.abs(collage.width - tethered.width), 'Collage and Tethered 50/50').toBeLessThan(2);
  // Photo shoot is first in keyboard order and chosen by default.
  const radios = dialog.locator('input[name="project-kind"]');
  await expect(radios.first()).toHaveValue('photography');
  await expect(radios.first()).toBeChecked();
  // Little or no scrolling on a 1366×768 laptop.
  const overflow = await dialog.locator('form > div').first().evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(overflow, 'scrolling needed inside the dialog (px)').toBeLessThan(140);
});

test('Create new project on a phone: the three choices stack, Photo shoot first', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'The phone layout.');
  const dialog = await openCreate(page);
  const box = async (kind: string) => (await dialog.getByTestId(`project-kind-${kind}`).boundingBox())!;
  const [photo, collage, tethered] = [await box('photography'), await box('collage'), await box('tethered')];
  expect(collage.y).toBeGreaterThan(photo.y);
  expect(tethered.y).toBeGreaterThan(collage.y);
  expect(Math.abs(collage.width - photo.width)).toBeLessThan(2);
});

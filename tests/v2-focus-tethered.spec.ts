import { expect, test } from '@playwright/test';

// Owner-approved layout job (D) and owner request (26 Nov): the filmstrip's row is calm by default on a phone (photos,
// Import and Folder; the rest under More), and live shooting belongs to its own project type, "Tethered shoot".
test('phone: focus mode keeps the filmstrip row to Import and Folder, with Auto pick under More', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Focus mode is on by default on a phone.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?v2&stub=1');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: 'Cairngorms Pinewood Stags', exact: true }).click();

  const strip = studio.locator('.v2-filmstrip');
  await expect(strip.getByRole('button', { name: /^Import$/ })).toHaveCount(1);
  await expect(strip.getByRole('button', { name: /^(Folder|Add photographs from a folder)$/ })).toHaveCount(1);
  await expect(strip.getByRole('button', { name: /Auto pick/ })).toHaveCount(0);

  // More holds Auto pick, and a switch that shows every button again.
  const more = strip.getByTestId('filmstrip-row-more');
  await more.getByText('More', { exact: true }).click();
  await expect(more.getByRole('button', { name: /Auto pick/ })).toBeVisible();
  const showAll = more.getByTestId('filmstrip-show-all-buttons');
  await expect(showAll).toHaveAttribute('aria-pressed', 'false');
  await showAll.click();
  await expect(strip.getByRole('button', { name: /Auto pick/ })).toHaveCount(1);
  // Saving the choice between sessions is the real workspace's (uiSettings.test.ts); the sample workspace keeps nothing.
});

test('Create new project offers Photo shoot, Collage or album, and Tethered shoot', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The dialog is the same on every screen; checked once.');
  await page.goto('/?v2');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: 'New project' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('project-kind-photography')).toBeVisible();
  await expect(dialog.getByTestId('project-kind-collage')).toBeVisible();
  const tethered = dialog.getByTestId('project-kind-tethered');
  await expect(tethered).toContainText('Tethered shoot');
  await tethered.click();
  await expect(tethered.getByRole('radio')).toBeChecked();
});

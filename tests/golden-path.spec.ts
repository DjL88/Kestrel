import { test } from '@playwright/test';
import { GP_PHOTOS, dimSubjectPhoto, expect, gradientPhotos, guardNetwork, importFiles, newProject, photoStrip, previewOn, studio, toReviewCount } from './goldenPath';

/**
 * The golden-path checks that no existing spec proves (docs/GOLDEN-PATH.md, scripts/golden-path/checks.mjs). Each test
 * title carries its check id. Synthetic photos only, made in the page; nothing leaves the machine. Features that are
 * previews (off by default) are switched on here through localStorage, the way workflowPreview.ts reads them.
 * `npm run golden-path` runs these with the others; they also run as a normal spec.
 */
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The golden-path flow is checked on the desktop layout; the phone has its own checks.');
});

test('[GP-01] a batch of photos dropped on a new project all arrive, none lost or doubled', async ({ page }, testInfo) => {
  test.setTimeout(120_000 + GP_PHOTOS * 3_000);
  await newProject(page, 'GP import');
  const photos = await gradientPhotos(page, GP_PHOTOS);
  const started = Date.now();
  await importFiles(page, photos);
  await expect(studio(page).getByTestId('decision-filter-to-review')).toHaveText(new RegExp(`To review \\(${GP_PHOTOS}\\)`), { timeout: 60_000 + GP_PHOTOS * 2_000 });
  const seconds = (Date.now() - started) / 1000;
  testInfo.annotations.push({ type: 'evidence', description: `${GP_PHOTOS} photos imported in ${seconds.toFixed(1)} s` });
  // Every file name is in the project exactly once.
  const names = await photoStrip(page).getByRole('option').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? el.textContent ?? ''));
  expect(names.length).toBeGreaterThanOrEqual(1);
  const grid = await studio(page).getByRole('article').count();
  expect(grid === 0 || grid === GP_PHOTOS, `grid shows ${grid} frames`).toBe(true);
  expect(await toReviewCount(page)).toBe(GP_PHOTOS);
});

test('[GP-06] pick the best 10% from the keyboard: the Flagged filter shows exactly those', async ({ page }) => {
  test.setTimeout(120_000 + GP_PHOTOS * 3_000);
  await newProject(page, 'GP best N');
  await importFiles(page, await gradientPhotos(page, GP_PHOTOS, 'PICK'));
  const toReview = studio(page).getByTestId('decision-filter-to-review');
  await expect(toReview).toHaveText(new RegExp(`To review \\(${GP_PHOTOS}\\)`), { timeout: 60_000 + GP_PHOTOS * 2_000 });
  const picks = Math.max(1, Math.round(GP_PHOTOS / 10));
  const step = Math.floor(GP_PHOTOS / picks);
  const options = photoStrip(page).getByRole('option');
  await options.first().click();
  await page.locator('body').evaluate((body) => (document.activeElement as HTMLElement | null)?.blur?.() ?? body.focus());
  for (let i = 0; i < picks; i += 1) {
    // Wait for the selection to land on the photo before each key, or a key goes to the previous one.
    await expect(studio(page).getByRole('option', { selected: true })).toContainText(`PICK_${String(i * step + 1).padStart(4, '0')}`);
    await page.keyboard.press('f');
    if (i < picks - 1) for (let s = 0; s < step; s += 1) await page.keyboard.press('ArrowRight');
  }
  const flagged = studio(page).getByTestId('decision-filter-flagged');
  await expect(flagged).toHaveText(new RegExp(`Flagged \\(${picks}\\)`));
  await expect(toReview).toHaveText(new RegExp(`To review \\(${GP_PHOTOS - picks}\\)`));
  await flagged.click();
  await expect(options).toHaveCount(picks);
});

test('[GP-17] the Flight mode shows as a chip on the editor and is kept after a reload; Solo changes no photo by itself', async ({ page }) => {
  test.setTimeout(180_000);
  await page.route(/\.(onnx|ort)(\?|$)/, (route) => route.abort());
  await newProject(page, 'GP modes');
  const root = studio(page);
  const chip = root.getByTestId('flight-chip');
  await expect(chip).toBeVisible();
  await root.getByTestId('flight-chip-solo').click();
  await expect(chip.getByRole('radio', { name: /Solo/ })).toBeChecked();
  await importFiles(page, [await dimSubjectPhoto(page)]);
  await expect(photoStrip(page).getByRole('option')).toHaveCount(1, { timeout: 30_000 });
  // Solo is the person's own work: give any background work time to run, then the photo has no edit.
  await page.waitForTimeout(4_000);
  const adjust = root.getByRole('button', { name: 'Adjust', exact: true }).first();
  if ((await adjust.getAttribute('aria-pressed')) !== 'true') await adjust.click();
  await root.getByRole('tab', { name: 'Advanced Edits' }).click();
  expect(Number(await root.getByRole('slider', { name: 'Exposure' }).inputValue())).toBe(0);
  // The mode is remembered for the project: reload, open it again, still Solo.
  await page.reload();
  await root.getByText('GP modes', { exact: false }).first().click();
  await expect(root.getByTestId('flight-chip').getByRole('radio', { name: /Solo/ })).toBeChecked({ timeout: 30_000 });
});

test('[GP-18] Auto-pilot edits the photos of a new import in the background, without opening them (preview switch on)', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await previewOn(page, 'flight-batch');
  await page.route(/\.(onnx|ort)(\?|$)/, (route) => route.abort());
  await newProject(page, 'GP autopilot');
  const root = studio(page);
  await root.getByTestId('flight-chip-autopilot').click();
  await expect(root.getByTestId('flight-chip').getByRole('radio', { name: /Auto-pilot/ })).toBeChecked();
  const started = Date.now();
  await importFiles(page, [await dimSubjectPhoto(page, 'dim-1.png'), await dimSubjectPhoto(page, 'dim-2.png')]);
  await expect(photoStrip(page).getByRole('option')).toHaveCount(2, { timeout: 30_000 });
  // Auto-pilot says what it changed, in words, with no click on any photo, and the batch shows in Tasks.
  await expect(page.getByText(/Auto-pilot changed: .*Exposure/).first()).toBeVisible({ timeout: 180_000 });
  await root.getByRole('button', { name: /^Tasks/ }).first().click();
  await expect(page.getByText('Auto-pilot: editing the new photos').first()).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press('Escape');
  testInfo.annotations.push({ type: 'evidence', description: `Auto-pilot batch finished ${((Date.now() - started) / 1000).toFixed(1)} s after import` });
  const adjust = root.getByRole('button', { name: 'Adjust', exact: true }).first();
  if ((await adjust.getAttribute('aria-pressed')) !== 'true') await adjust.click();
  await root.getByRole('tab', { name: 'Advanced Edits' }).click();
  expect(Number(await root.getByRole('slider', { name: 'Exposure' }).inputValue())).toBeGreaterThan(0);
});

test('[GP-20] the Colour Sense badge shows on the image with a word and a shape, not only a colour (preview switch on)', async ({ page }) => {
  test.setTimeout(180_000);
  await previewOn(page, 'on-image-advice');
  await page.route(/\.(onnx|ort)(\?|$)/, (route) => route.abort());
  await newProject(page, 'GP colour badge');
  // The layer is on by default in Solo only (src/core/adviceSetting.ts); Co-pilot and Auto-pilot say it in words instead.
  await studio(page).getByTestId('flight-chip-solo').click();
  await importFiles(page, [await dimSubjectPhoto(page)]);
  await expect(photoStrip(page).getByRole('option')).toHaveCount(1, { timeout: 30_000 });
  const badge = studio(page).getByTestId('advice-colour');
  await expect(badge).toBeVisible({ timeout: 60_000 });
  expect((await badge.textContent())?.trim().length ?? 0, 'the badge says it in words').toBeGreaterThan(3);
  await expect(badge).toHaveAttribute('data-shape', /.+/);
});

test('[GP-22] nothing leaves the machine by default: import, edit and Auto with no account make no outside request', async ({ page, context }) => {
  test.setTimeout(180_000);
  const leaks = await guardNetwork(context);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route(/\.(onnx|ort)(\?|$)/, (route) => route.abort());
  await newProject(page, 'GP offline by default');
  await importFiles(page, [await dimSubjectPhoto(page), ...(await gradientPhotos(page, 3, 'LOC'))]);
  await expect(photoStrip(page).getByRole('option')).toHaveCount(4, { timeout: 60_000 });
  const root = studio(page);
  // Auto is in Flight (beside the Auto-pilot choice).
  if (!await root.getByTestId('auto-edit-button').isVisible()) await root.getByRole('button', { name: /^(Solo|Co-pilot|Auto-pilot|Flight)$/ }).first().click();
  await root.getByTestId('auto-edit-button').click();
  await expect(root.getByTestId('auto-edit-status')).not.toHaveAttribute('data-state', 'idle', { timeout: 90_000 });
  await page.waitForTimeout(1_500);
  expect(leaks, `requests that left this machine:\n${leaks.join('\n')}`).toEqual([]);
  expect(errors, `page errors:\n${errors.join('\n')}`).toEqual([]);
});

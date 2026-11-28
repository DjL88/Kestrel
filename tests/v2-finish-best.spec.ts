import { expect, test, type Page } from '@playwright/test';

// Finish best (x-std-finish-best), a preview off by default: with the preview switch on, the chooser opens with focus in
// its field, says what a request means before anything runs, and a batch on a few synthetic photos ends in words (a
// notice and a review), never silently. Off, the button is not there. These textures are not real photographs, so the
// test does not judge the edits, only that the flow is reachable by keyboard, honest and complete.

test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'Desktop filmstrip.'); });

async function textures(page: Page): Promise<string[]> {
  return page.evaluate(() => [6, 14, 30, 60].map((cell, i) => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 240;
    const g = c.getContext('2d')!;
    for (let y = 0; y < 240; y += cell) for (let x = 0; x < 320; x += cell) {
      g.fillStyle = (x / cell + y / cell) % 2 ? `rgb(${200 - i * 20},180,160)` : `rgb(40,${60 + i * 20},90)`;
      g.fillRect(x, y, cell, cell);
    }
    return c.toDataURL('image/png').split(',')[1];
  }));
}

async function openProject(page: Page, preview: boolean) {
  if (preview) await page.addInitScript(() => localStorage.setItem('kestrel.preview.finish-best.v1', '1'));
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Finish best');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const files = await textures(page);
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles(files.map((data, i) => ({ name: `texture_${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') })));
  const options = root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option');
  await expect(options).toHaveCount(4, { timeout: 30000 });
  return { root, options };
}

test('without the preview switch there is no Finish best button', async ({ page }) => {
  const { root } = await openProject(page, false);
  await expect(root.getByTestId('finish-best-button')).toHaveCount(0);
});

test('the chooser takes focus into its field, closes on Escape, and a batch on all photos ends in words and a review', async ({ page }) => {
  test.setTimeout(180_000);
  const { root } = await openProject(page, true);
  const entry = root.getByTestId('finish-best-button').first();
  await expect(entry).toBeVisible();

  // Opens with focus inside, on the field that is on screen; Escape closes it and gives focus back.
  await entry.click();
  const dialog = page.getByTestId('finish-best-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('input[type="number"]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // No stars and no Auto pick score yet, so "best" has nothing to choose; "All photos" takes every one, in words.
  await entry.click();
  await expect(dialog.getByTestId('finish-summary')).toContainText(/Nothing to finish|0 of 4|Best/);
  await dialog.getByLabel('All photos').check();
  await expect(dialog.getByTestId('finish-summary')).toContainText('All photos: 4 of 4');
  await dialog.getByTestId('finish-start').click();
  await expect(dialog).toHaveCount(0);

  // Never silent: the batch ends with a notice that says how many it looked at, and its results are in Review.
  await expect(page.getByText(/Looked at 4 photos|Stopped after|could not be finished/).first()).toBeVisible({ timeout: 150_000 });
  const review = root.getByTestId('finish-review-button').first();
  await expect(review).toBeVisible();
  await review.click();
  const reviewDialog = page.getByTestId('finish-review-dialog');
  await expect(reviewDialog).toBeVisible();
  // Before and After are said in words and the chosen one carries a mark as well as a colour.
  await expect(reviewDialog.getByTestId('finish-show-after')).toHaveAttribute('aria-pressed', 'true');
  await expect(reviewDialog.getByTestId('finish-show-after')).toContainText('✓');
  await expect(reviewDialog.getByTestId('finish-show-before')).not.toContainText('✓');
  await page.keyboard.press('Escape');
  await expect(reviewDialog).toHaveCount(0);
});

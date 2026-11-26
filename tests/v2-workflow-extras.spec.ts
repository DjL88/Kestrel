import { expect, test, type Page } from '@playwright/test';

// Small offline workflow extras (on by default since 26 Nov 2026): saved views of the filmstrip's filters, and N / Shift+N to
// jump to the next or previous photo still to review.

test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'Desktop filmstrip and keyboard.'); });

/** Four small distinct PNGs, so each import is its own photo. */
async function pngs(page: Page): Promise<string[]> {
  return page.evaluate(() => ['#a05030', '#3070a0', '#40a060', '#a0a040'].map((colour) => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 48;
    const g = c.getContext('2d')!; g.fillStyle = colour; g.fillRect(0, 0, 64, 48);
    return c.toDataURL('image/png').split(',')[1];
  }));
}

async function openProject(page: Page, previews: boolean) {
  if (previews) {
    await page.addInitScript(() => {
      localStorage.setItem('kestrel.preview.saved-views.v1', '1');
      localStorage.setItem('kestrel.preview.next-to-review.v1', '1');
    });
  }
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Workflow extras');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const files = await pngs(page);
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles(files.map((data, i) => ({ name: `walk_${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') })));
  const strip = root.getByRole('listbox', { name: 'Project photographs' });
  const options = strip.getByRole('option');
  await expect(options).toHaveCount(4, { timeout: 30000 });
  const selected = () => options.evaluateAll((els) => els.findIndex((el) => el.getAttribute('aria-selected') === 'true'));
  return { root, options, selected };
}

test('N and Shift+N jump over photos that already have a decision, and say so at the end', async ({ page }) => {
  const { root, options, selected } = await openProject(page, true);
  // Flag the second and third photos, then start on the first.
  await options.nth(1).click();
  await page.keyboard.press('f');
  await options.nth(2).click();
  await page.keyboard.press('f');
  await options.nth(0).click();
  await expect.poll(selected).toBe(0);

  await page.keyboard.press('n');
  await expect.poll(selected).toBe(3);
  await page.keyboard.press('n');
  await expect(root.getByText('No more photos to review after this one in the photos shown.')).toBeVisible();
  await expect.poll(selected).toBe(3);
  await page.keyboard.press('Shift+N');
  await expect.poll(selected).toBe(0);

  // Listed in the keyboard guide while the preview is on.
  await page.keyboard.press('?');
  await expect(page.getByText('Next photo to review')).toBeVisible();
});

test('a saved view puts every filter back with one choice and is still there after a reload', async ({ page }) => {
  const { root, options } = await openProject(page, true);
  await options.nth(0).click();
  await page.keyboard.press('f');
  await options.nth(1).click();
  await page.keyboard.press('f');

  await root.getByTestId('decision-filter-flagged').first().click();
  await root.getByTestId('view-options').first().click();
  await root.getByTestId('view-sort').selectOption('filename');
  await root.getByTestId('saved-view-name').fill('Flagged by name');
  await root.getByRole('button', { name: 'Save view' }).click();
  await expect(root.getByText('Saved the view Flagged by name.')).toBeVisible();

  // Back to everything, then one choice restores both the decision filter and the order.
  await root.getByTestId('view-sort').selectOption('shoot');
  await page.keyboard.press('Escape');
  await root.getByTestId('decision-filter-all').first().click();
  await expect(options).toHaveCount(4);
  await root.getByTestId('view-options').first().click();
  await root.getByRole('button', { name: 'Show Flagged by name' }).click();
  await expect(options).toHaveCount(2);
  await expect(root.getByTestId('decision-filter-flagged').first()).toHaveAttribute('aria-pressed', 'true');
  await expect(root.getByTestId('view-sort')).toHaveValue('filename');
  await expect(root.getByRole('button', { name: 'Show Flagged by name' })).toHaveAttribute('aria-current', 'true');

  // Kept on this device: still stored after a reload.
  await page.reload();
  const stored = await page.evaluate(() => localStorage.getItem('kestrel.saved-views.v1'));
  expect(JSON.parse(stored ?? '[]')).toEqual([expect.objectContaining({ name: 'Flagged by name', criteria: expect.objectContaining({ filter: 'flagged', sort: 'filename' }) })]);
});

test('on by default: without the device switches, saved views and the next-to-review keys are offered', async ({ page }) => {
  const { root, options } = await openProject(page, false);
  await options.nth(0).click();
  await root.getByTestId('view-options').first().click();
  await expect(root.getByTestId('view-sort')).toBeVisible();
  await expect(root.getByTestId('saved-views').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await options.nth(0).click();
  await page.keyboard.press('?');
  await expect(page.getByText('Next photo to review').first()).toBeVisible();
});

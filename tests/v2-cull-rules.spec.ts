import { expect, test, type Page } from '@playwright/test';

// Culling Assistant rules (x-std-cull-rules) on stored cull observations (x-std-rescore), a preview off by default.
// After one Auto-cull pass the assistant ranks every photo from what the scan stored, re-sorting as a slider moves,
// with no new scan. These synthetic textures have no subject the detector trusts, so every photo is uncertain: the
// rules must leave all of them for review and offer nothing to keep, however the sliders are set.

test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'Desktop filmstrip.'); });

/** Four distinct textured PNGs, big enough for the 256 px detail pass (64 px is the minimum). */
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
  if (preview) await page.addInitScript(() => localStorage.setItem('kestrel.preview.cull-rules.v1', '1'));
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Cull rules');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const files = await textures(page);
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles(files.map((data, i) => ({ name: `texture_${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') })));
  const options = root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option');
  await expect(options).toHaveCount(4, { timeout: 30000 });
  return { root, options };
}

test('after one scan the rules re-rank live from storage, keep nothing uncertain and change no decision', async ({ page }) => {
  test.setTimeout(120_000);
  const { root, options } = await openProject(page, true);
  const assistant = root.getByTestId('open-cull-assistant');
  await expect(assistant).toBeVisible();

  // Before any scan there is nothing to rank.
  await assistant.click();
  const dialog = page.getByRole('dialog', { name: 'Culling Assistant' });
  await expect(dialog.getByTestId('cull-rules-summary')).toHaveText(/No photos have been scanned yet/);
  await dialog.getByRole('button', { name: 'Close' }).click();

  const decisions = () => options.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''));
  const rows = dialog.getByTestId('cull-rules-list').getByRole('listitem');
  // By design a photo the subject detector never ran on counts as "not scanned" and is looked at once more. On a slow or
  // busy machine the on-device detector now and then misses its window for one scan (and the dialog then opens with no
  // rows), so the test scans again, at most twice more, as a person would. It never waits on a scan that stored nothing.
  let before: string[] = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await root.getByRole('button', { name: /Auto pick/ }).first().click();
    await expect(root.getByText(/Photos checked by Auto pick: 4\./)).toBeVisible({ timeout: 90_000 });
    before = await decisions();
    await assistant.click();
    await expect(dialog.getByTestId('cull-rules-summary')).toBeVisible();
    if (await rows.count() === 4) break;
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
    expect(attempt, 'three scans in a row stored no observations').toBeLessThan(3);
  }
  await expect(rows).toHaveCount(4);
  await expect(dialog.getByTestId('cull-rules-summary')).toHaveText('0 to keep · 4 for review');
  await expect(dialog.getByText('Uncertain, so it stays for you to review')).toHaveCount(4);

  // Drag every rule to its most generous setting: still nothing uncertain is offered.
  await dialog.getByTestId('cull-rule-minQuality').fill('0');
  await expect(dialog.getByTestId('cull-rule-minQuality-value')).toHaveText('0');
  await dialog.getByTestId('cull-rule-keepAtLeast').fill('10');
  await expect(dialog.getByTestId('cull-rule-keepAtMost-value')).toHaveText('10');
  await expect(dialog.getByTestId('cull-rules-summary')).toHaveText('0 to keep · 4 for review');
  await expect(dialog.getByTestId('cull-rules-apply')).toBeDisabled();
  // "At most" carries "at least" down with it.
  await dialog.getByTestId('cull-rule-keepAtMost').fill('3');
  await expect(dialog.getByTestId('cull-rule-keepAtLeast-value')).toHaveText('3');
  // Each row says its outcome in words, never by colour alone.
  await expect(rows.first()).toContainText('Review');

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await decisions()).toEqual(before);
});

test('with the preview off there is no Culling Assistant', async ({ page }) => {
  const { root } = await openProject(page, false);
  await expect(root.getByRole('button', { name: /Auto pick/ }).first()).toBeVisible();
  await expect(root.getByTestId('open-cull-assistant')).toHaveCount(0);
});

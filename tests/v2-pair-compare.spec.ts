import { expect, test } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop multi-select.');
});

test('?v2 two selected photos compare side by side; keys act on the chosen side only', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Pair check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const pngs = await page.evaluate(() => ['#333', '#999'].map((fill) => {
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 100;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = fill; ctx.fillRect(0, 0, 160, 100);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles(['one.png', 'two.png'].map((name, i) => ({ name, mimeType: 'image/png', buffer: Buffer.from(pngs[i], 'base64') })));
  const options = root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option');
  await expect(options).toHaveCount(2, { timeout: 30000 });
  await options.nth(0).click();
  await options.nth(1).click({ modifiers: ['ControlOrMeta'] });
  await root.getByTestId('compare-selected').click();

  const pair = root.getByTestId('pair-compare');
  await expect(pair).toBeVisible();
  await expect(pair.getByRole('article')).toHaveCount(2);
  // Flag the left with its own button: the right is untouched.
  await root.getByTestId('pair-flag-0').click();
  await expect(root.getByTestId('pair-decision-0')).toHaveText(/Flagged/);
  await expect(root.getByTestId('pair-decision-1')).toHaveText(/To review/);
  // Choose the right with the arrow key; the flag key then flags only the right.
  await root.getByTestId('pair-pane-0').focus();
  await page.keyboard.press('ArrowRight');
  await expect(root.getByTestId('pair-pane-1')).toHaveAttribute('data-chosen', 'true');
  await expect(root.getByTestId('pair-pane-1')).toContainText('Chosen');
  await page.keyboard.press('f');
  await expect(root.getByTestId('pair-decision-1')).toHaveText(/Flagged/);
  await expect(root.getByTestId('pair-decision-0')).toHaveText(/Flagged/);
  // Set the left aside, then swap sides and go back to one photo.
  await root.getByTestId('pair-aside-0').click();
  await expect(root.getByTestId('pair-decision-0')).toHaveText(/Set aside/);
  await pair.getByRole('button', { name: 'Swap sides' }).click();
  await expect(root.getByTestId('pair-decision-1')).toHaveText(/Set aside/);
  await pair.getByRole('button', { name: 'Back to one photo' }).click();
  await expect(pair).toHaveCount(0);
});

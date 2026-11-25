import { expect, test } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop filmstrip.');
});

test('?v2 the filmstrip filters by decision and rating, sorts by file name, and says so in words', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('View check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const pngs = await page.evaluate(() => ['#222', '#555', '#888'].map((fill) => {
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 100;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = fill; ctx.fillRect(0, 0, 160, 100);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles(['c-shot.png', 'a-shot.png', 'b-shot.png'].map((name, i) => ({ name, mimeType: 'image/png', buffer: Buffer.from(pngs[i], 'base64') })));
  const options = root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option');
  await expect(options).toHaveCount(3, { timeout: 30000 });

  // Every photo starts with no decision, so all three are "to review".
  await expect(root.getByTestId('decision-filter-to-review')).toHaveText(/To review \(3\)/);
  await options.first().click();
  await page.keyboard.press('f');
  await expect(root.getByTestId('decision-filter-to-review')).toHaveText(/To review \(2\)/);
  await expect(root.getByTestId('decision-filter-flagged')).toHaveText(/Flagged \(1\)/);
  await root.getByTestId('decision-filter-to-review').click();
  await expect(root.getByTestId('decision-filter-to-review')).toHaveAttribute('aria-pressed', 'true');
  await expect(options).toHaveCount(2);
  await root.getByTestId('decision-filter-all').click();
  await expect(options).toHaveCount(3);

  // Sort by file name: the button names the active order, and the reset puts shoot order back.
  await root.getByTestId('view-options').click();
  await root.getByTestId('view-sort').selectOption('filename');
  await expect(root.getByTestId('view-options')).toContainText('File name');
  await expect(options.first()).toContainText(/a-shot/);
  await root.getByTestId('view-min-rating').selectOption('4');
  await expect(options).toHaveCount(0);
  await expect(root.getByTestId('view-options')).toContainText('4+ stars');
  await root.getByRole('button', { name: 'Show all, shoot order' }).click();
  await expect(options).toHaveCount(3);
  await expect(root.getByTestId('view-options')).not.toContainText('File name');
});

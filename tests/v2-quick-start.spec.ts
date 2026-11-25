import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'First-run flow on the desktop browser layout.');
});

test('?v2 first run: one click and a photo give an Auto-edited photo ready to export within a minute', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  const started = Date.now();
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: 'Make a great photo in a minute' }).click();
  await (await chooser).setFiles([{ name: 'DSC_0042.jpg', mimeType: 'image/jpeg', buffer: readFileSync('tests/fixtures/exif-photo.jpg') }]);

  const card = root.getByTestId('quick-start-card');
  await expect(card).toContainText('Your first photo');
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1, { timeout: 30000 });
  // Auto either balanced it or said, honestly, that it already looked natural; never a silent wait.
  await expect(card.getByRole('status')).toHaveText(/Auto balanced the exposure and colour|already looks natural/, { timeout: 50000 });
  expect(Date.now() - started).toBeLessThan(60000);
  const auto = (await card.getByRole('status').textContent())?.startsWith('Auto balanced');
  if (auto) {
    // Learn as you go: History says Auto made the step, what changed with real values, why, and one tap takes it back.
    await root.getByRole('button', { name: 'History', exact: true }).first().click();
    const history = root.getByRole('list', { name: 'History' });
    await expect(history).toContainText('Auto');
    await expect(root.getByText('What changed')).toBeVisible();
    await expect(root.getByText('Why', { exact: true })).toBeVisible();
    await root.getByRole('button', { name: 'Undo this change' }).click();
    await expect(root.getByRole('button', { name: 'Undo this change' })).toHaveCount(0);
  }
  await card.getByRole('button', { name: 'Export…' }).click();
  await expect(page.getByRole('dialog').filter({ hasText: /Export/ }).first()).toBeVisible();
  await expect(card).toHaveCount(0);
});

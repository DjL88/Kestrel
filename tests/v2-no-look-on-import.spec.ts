import { expect, test } from '@playwright/test';

// Import never applies a look: a new photo opens with "None" chosen and every slider where it starts. Choosing a look
// and then None takes that look's sliders back off.

test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'Desktop side panel.'); });

test('a new photo opens with no look, and None takes a look back off', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('No look check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const image = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 300; c.height = 200;
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#6a7480'; ctx.fillRect(0, 0, 300, 200);
    return c.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') }]);
  await expect(root.getByTestId('canvas-frame').locator('img').first()).toBeVisible({ timeout: 30000 });
  const styles = root.getByRole('tab', { name: 'Photo styles' });
  if (!(await styles.isVisible())) await root.getByRole('button', { name: 'Adjust', exact: true }).first().click();
  await expect(styles).toBeVisible();

  await expect(root.getByRole('button', { name: /^None preview None · Applied/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(root.getByRole('button', { name: /^Natural True/ })).toHaveAttribute('aria-pressed', 'false');
  await root.getByRole('tab', { name: 'Advanced Edits' }).click();
  await expect(root.getByRole('slider', { name: /^Shadows/ }).first()).toHaveValue('0');
  await expect(root.getByRole('slider', { name: /^Contrast/ }).first()).toHaveValue('0');

  await root.getByRole('tab', { name: 'Photo styles' }).click();
  await root.getByRole('button', { name: /^Highland Mist/ }).click();
  await root.getByRole('tab', { name: 'Advanced Edits' }).click();
  await expect(root.getByRole('slider', { name: /^Shadows/ }).first()).toHaveValue('26');
  await root.getByRole('tab', { name: 'Photo styles' }).click();
  await root.getByRole('button', { name: /^None preview/ }).click();
  await expect(root.getByRole('button', { name: /^None preview None · Applied/ })).toHaveAttribute('aria-pressed', 'true');
  await root.getByRole('tab', { name: 'Advanced Edits' }).click();
  await expect(root.getByRole('slider', { name: /^Shadows/ }).first()).toHaveValue('0');
});

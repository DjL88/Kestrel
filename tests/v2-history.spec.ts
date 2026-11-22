import { expect, test } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Uses the desktop tool rail; on a phone History is in the More sheet.');
});

test('?v2 History lists real edit steps; choosing Original goes back and the later step can be chosen again', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('History check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 200;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#557799'; ctx.fillRect(0, 0, 300, 200);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'history-1.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);

  await root.getByRole('button', { name: 'History' }).first().click();
  await expect(root.getByText('No edits yet.')).toBeVisible();

  await root.getByRole('button', { name: 'Adjust' }).first().click();
  await root.getByRole('tab', { name: 'Advanced Edits' }).click();
  const exposure = root.getByRole('slider', { name: 'Exposure' });
  await exposure.fill('1');
  await expect(exposure).toHaveValue('1');

  await root.getByRole('button', { name: 'History' }).first().click();
  const steps = root.getByRole('list', { name: 'History' }).getByRole('button');
  await expect(steps).toHaveCount(2);
  await expect(steps.nth(1)).toHaveAttribute('aria-current', 'step');

  await steps.nth(0).click();
  await expect(steps.nth(0)).toHaveAttribute('aria-current', 'step');
  await root.getByRole('button', { name: 'Adjust' }).first().click();
  await root.getByRole('tab', { name: 'Advanced Edits' }).click();
  await expect(exposure).toHaveValue('0');

  await root.getByRole('button', { name: 'History' }).first().click();
  await steps.nth(1).click();
  await root.getByRole('button', { name: 'Adjust' }).first().click();
  await root.getByRole('tab', { name: 'Advanced Edits' }).click();
  await expect(exposure).toHaveValue('1');
});

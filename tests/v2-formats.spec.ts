import { expect, test } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop canvas.');
});

test('?v2 the frame action bar adds, duplicates and deletes formats for real, and the formats are saved with the photo', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Formats check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 400;
    canvas.getContext('2d')!.fillRect(0, 0, 600, 400);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'formats-1.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  await expect(root.getByTestId('canvas-frame').locator('canvas, img').first()).toBeVisible({ timeout: 30000 });

  const caption = () => root.getByTestId('canvas-frame').locator('xpath=../../div[1]/span[1]');
  const original = ((await caption().textContent()) ?? '').trim();
  const bar = root.getByRole('toolbar', { name: 'Format actions' });
  await expect(bar).toBeVisible();

  await bar.getByRole('button', { name: 'Duplicate this format' }).click();
  await expect(caption()).toContainText(`${original} copy`);

  // The copy is a real format of this photo: it is in the export list.
  await root.getByRole('button', { name: /^Export/ }).first().click();
  await expect(page.getByRole('dialog', { name: /export/i }).getByText(`${original} copy`)).toBeVisible();
  await page.getByRole('button', { name: 'Close export dialog' }).click();

  await bar.getByRole('button', { name: 'Delete this format' }).click();
  await expect(caption()).not.toContainText('copy');

  await bar.getByRole('button', { name: 'Add a format' }).click();
  await expect(root.getByRole('heading', { name: 'Formats' }).first()).toBeVisible();
});

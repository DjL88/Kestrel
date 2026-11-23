import { expect, test } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Uses the desktop Formats panel.');
});

test('?v2 a format border shows on the canvas and is drawn in the exported file, per format', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Border check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 400;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#3070c0'; ctx.fillRect(0, 0, 800, 400);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'border-1.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  await expect(root.getByTestId('canvas-frame').locator('canvas, img').first()).toBeVisible({ timeout: 30000 });
  const shown = ((await root.getByTestId('canvas-frame').locator('xpath=../../div[1]/span[1]').textContent()) ?? '').trim();

  await root.getByRole('button', { name: 'Formats' }).first().click();
  await expect(root.getByTestId('format-border')).toHaveCount(0);
  await root.locator('#format-border-slider').fill('10');
  await root.getByRole('button', { name: 'Black' }).click();
  await expect(root.getByTestId('format-border').first()).toBeVisible();

  await root.getByRole('button', { name: /^Export/ }).first().click();
  const dialog = page.getByRole('dialog', { name: /export/i });
  await dialog.getByRole('button', { name: /Download individual files/i }).click();
  const sizes = dialog.locator('.grid.grid-cols-2 button[aria-pressed="true"]');
  const names = (await sizes.allTextContents()).filter((text) => !text.includes(shown));
  for (const name of names) await dialog.locator('.grid.grid-cols-2 button[aria-pressed="true"]', { hasText: name }).first().click();
  const downloading = page.waitForEvent('download', { timeout: 60000 });
  await dialog.getByRole('button', { name: /export bundle/i }).click();
  const path = await (await downloading).path();
  const { readFileSync } = await import('node:fs');
  const result = await page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${data}`)).blob());
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0);
    const px = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
    return { w: bitmap.width, h: bitmap.height, corner: px(2, 2), edge: px(Math.floor(bitmap.width / 2), 2), middle: px(Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2)) };
  }, readFileSync(path!).toString('base64'));
  // 10 percent of the width is a thick black band at the edge; the middle is still the picture.
  expect(Math.max(...result.corner)).toBeLessThan(40);
  expect(Math.max(...result.edge)).toBeLessThan(40);
  expect(result.middle[2]).toBeGreaterThan(result.middle[0] + 50);
});

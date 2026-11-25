import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop filmstrip.');
});

test('?v2 a RAW and its JPEG import as one photo marked RAW + JPEG; a flag covers both files', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Pair check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  // The camera's JPEG of the same shot (no recorded time here, so only the name and folder pair it).
  const jpeg = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 200;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#4a6'; ctx.fillRect(0, 0, 300, 200);
    return canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([
    { name: 'Z8_0001.DNG', mimeType: 'image/x-adobe-dng', buffer: readFileSync('tests/fixtures/synthetic-z8.dng') },
    { name: 'Z8_0001.JPG', mimeType: 'image/jpeg', buffer: Buffer.from(jpeg, 'base64') },
    { name: 'OTHER.JPG', mimeType: 'image/jpeg', buffer: readFileSync('tests/fixtures/exif-photo.jpg') },
  ]);
  const options = root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option');
  await expect(root.getByTestId('pair-badge')).toHaveCount(1, { timeout: 30000 });
  await expect(options).toHaveCount(2);
  await expect(options.filter({ hasText: 'RAW + JPEG' })).toContainText('Z8_0001.DNG');

  // Flag the paired photo: one photo is flagged in the count, and both files carry it (seen through XMP save scope).
  await options.filter({ hasText: 'RAW + JPEG' }).click();
  await page.keyboard.press('f');
  await expect(root.getByTestId('decision-filter-flagged')).toHaveText(/Flagged \(1\)/);
  await root.getByRole('button', { name: 'Info', exact: true }).first().click();
  await expect(root.getByText('Z8_0001.JPG')).toBeVisible();
});

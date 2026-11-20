import { expect, test } from '@playwright/test';
import { openExportDialog } from './helpers';

/** Proof pixels must reflect the active crop, not an earlier completion. */
test('export proof hides superseded pixels during a rapid zoom change', async ({ page }) => {
  await page.goto('/');
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 900; canvas.height = 600;
    const paint = canvas.getContext('2d')!;
    paint.fillStyle = '#23405a'; paint.fillRect(0, 0, 900, 600);
    paint.fillStyle = '#eaa75f'; paint.fillRect(0, 0, 180, 600);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByTestId('quick-edit-input').setInputFiles({
    name: 'proof-race.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64'),
  });
  await openExportDialog(page);
  await page.getByRole('button', { name: 'Show all formats at once' }).click();
  const instagram = page.locator('details', { has: page.getByText('Instagram', { exact: true }) });
  await instagram.getByText('Instagram', { exact: true }).click();
  await instagram.getByRole('checkbox', { name: /Post · 4:5/ }).check();

  const proof = page.getByRole('complementary', { name: 'Export proof' });
  const picture = proof.getByRole('img', { name: /Preview of/ });
  await expect.poll(() => picture.evaluate((node: HTMLCanvasElement) => node.width > 0 && node.height > 0)).toBe(true);
  const before = await picture.evaluate((node: HTMLCanvasElement) => node.toDataURL());
  const crop = proof.getByRole('group', { name: /Crop position/ });
  await crop.focus();
  await crop.press('+');
  await crop.press('+');
  // The canvas remains hidden while the new composition is still pending.
  await expect.poll(() => proof.getByRole('img', { name: /Preview of/ }).evaluate((node: HTMLCanvasElement) =>
    node.width > 0 && node.height > 0)).toBe(true);
  const after = await proof.getByRole('img', { name: /Preview of/ }).evaluate((node: HTMLCanvasElement) => node.toDataURL());
  expect(after).not.toBe(before);
  await expect(proof.getByText('Updating proof…')).toHaveCount(0);
});

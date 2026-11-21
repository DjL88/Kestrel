import { expect, test } from '@playwright/test';
import { mosaic, withPreview } from './rawFixture';

/**
 * After photos are added to a project, every RAW is developed from its sensor data in the background, and its tile swaps
 * the camera's embedded JPEG for Kite44's own develop. The file is synthetic (tests/fixtures) with an added embedded
 * preview, as cameras store one.
 */
test('RAW photos are developed in the background and their tiles show Kite44\'s develop', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const preview = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 960;
    const c = canvas.getContext('2d')!; c.fillStyle = '#ff0000'; c.fillRect(0, 0, 640, 960);
    return canvas.toDataURL('image/jpeg', 0.92).split(',')[1];
  }), 'base64');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Background develop');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles({ name: 'synthetic.dng', mimeType: 'application/octet-stream', buffer: withPreview(mosaic, preview) });
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 1' })).toBeVisible({ timeout: 30000 });

  // The tile first shows the camera's embedded preview (a 640 × 960 JPEG, drawn 400 wide), then Kite44's develop of the
  // 96 × 64 sensor, turned upright: 64 × 96. Sizes tell the two apart; colour alone would not.
  const tileWidth = () => page.evaluate(() => {
    const img = [...document.querySelectorAll('img')].find((image) => image.src.startsWith('blob:') && image.naturalWidth > 0);
    return img ? img.naturalWidth : 0;
  });
  await expect.poll(tileWidth, { timeout: 90_000, intervals: [500] }).toBe(64);

  // Kept for next time: the developed picture is stored beside the previews, never the original.
  const stored = await page.evaluate(() => new Promise<string[]>((resolve) => {
    const open = indexedDB.open('kestrel-offline-previews-v1');
    open.onsuccess = () => {
      const keys = open.result.transaction('previews').objectStore('previews').getAllKeys();
      keys.onsuccess = () => resolve((keys.result as string[]).filter((key) => String(key).startsWith('developed-v1:')));
    };
  }));
  expect(stored).toHaveLength(1);
});

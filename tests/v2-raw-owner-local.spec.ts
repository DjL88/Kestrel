import { expect, test, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

/**
 * The owner's own HE/HE* NEF, read from the local disk only: never committed or uploaded. Skipped unless
 * KESTREL_OWNER_NEF names the file. Reproduces the 25 Nov report: Single view shows the photo, All formats a broken image.
 */
async function boardImagesLoaded(root: Locator) {
  const images = root.getByTestId('all-formats-board').locator('img[alt*=" — "]');
  await expect(images.first()).toBeVisible();
  await expect.poll(() => images.evaluateAll((list) => list.every((el) => {
    const image = el as HTMLImageElement;
    return image.complete && image.naturalWidth > 0;
  })), { timeout: 30_000 }).toBe(true);
}

test('local only: an owner HE NEF stays visible on the All formats board after its background develop', async ({ page }, testInfo) => {
  const path = process.env.KESTREL_OWNER_NEF;
  test.skip(!path, 'Set KESTREL_OWNER_NEF to a local NEF to run this check.');
  test.skip(testInfo.project.name !== 'desktop', 'One project is enough for a large local file.');
  test.setTimeout(240_000);
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Owner HE NEF board');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const picker = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: 'Import', exact: true }).click();
  await (await picker).setFiles([{ name: basename(path!), mimeType: 'application/octet-stream', buffer: await readFile(path!) }]);
  const photo = root.getByTestId('canvas-frame').locator('img').first();
  await expect.poll(() => photo.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 60_000 }).toBeGreaterThan(0);
  // Wait for the background develop to replace the embedded JPEG (a new picture URL): that revokes the old one.
  const start = await photo.evaluate((el: HTMLImageElement) => el.src);
  await expect.poll(() => photo.evaluate((el: HTMLImageElement, first) => el.complete && el.naturalWidth > 0 && el.src !== first,
    start), { timeout: 150_000 }).toBe(true);
  await root.getByRole('button', { name: /All formats/ }).click();
  await boardImagesLoaded(root);
});

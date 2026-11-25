import { expect, test, type Page } from '@playwright/test';
import { mosaic, withPreview } from './rawFixture';

/** A camera-style JPEG preview: a light disc (the subject) on a darker gradient. */
async function previewJpeg(page: Page): Promise<Buffer> {
  return Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 960; canvas.height = 640;
    const ctx = canvas.getContext('2d')!;
    const sky = ctx.createLinearGradient(0, 0, 960, 640);
    sky.addColorStop(0, '#a33'); sky.addColorStop(1, '#246');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, 960, 640);
    ctx.fillStyle = '#ddd'; ctx.beginPath(); ctx.arc(480, 320, 160, 0, Math.PI * 2); ctx.fill();
    return canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
  }), 'base64');
}

/** The synthetic DNG marked with a compression InFlight's decoder does not develop, as an HE* NEF is for this device. */
function undevelopable(dng: Buffer): Buffer {
  const out = Buffer.from(dng);
  const ifd = out.readUInt32LE(4);
  for (let i = 0; i < out.readUInt16LE(ifd); i += 1) {
    const at = ifd + 2 + i * 12;
    if (out.readUInt16LE(at) === 259) out.writeUInt16LE(34713, at + 8);
  }
  return out;
}

async function importRaw(page: Page, name: string, bytes: Buffer) {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill(name);
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const picker = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: 'Import', exact: true }).click();
  await (await picker).setFiles([{ name, mimeType: 'application/octet-stream', buffer: bytes }]);
  await expect(root.getByTestId('canvas-frame').locator('img').first()).toBeVisible();
  return root;
}

test('V2 split frames of a developed RAW show the picture, never a released preview address', async ({ page }) => {
  test.skip(test.info().project.name === 'phone', 'The split layout is checked on the desktop canvas.');
  const root = await importRaw(page, 'split.dng', withPreview(mosaic, await previewJpeg(page)));
  const photo = root.getByTestId('canvas-frame').locator('img').first();
  // Wait for the developed sensor picture (64 × 96) to replace the embedded preview, which releases its address.
  await expect.poll(() => photo.evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight]), { timeout: 30_000 }).toEqual([64, 96]);
  await root.getByRole('button', { name: 'Formats', exact: true }).first().click();
  await root.getByRole('button', { name: '3 frames' }).first().click();
  for (let pane = 1; pane <= 3; pane += 1) {
    const image = root.getByAltText(new RegExp(`Frame ${pane}$`));
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), { timeout: 15_000 }).toBe(true);
  }
});

test('V2 finds the subject of a RAW this device cannot develop, from the preview it shows', async ({ page }) => {
  test.skip(test.info().project.name === 'phone', 'Mask tools are checked on the desktop panel.');
  const root = await importRaw(page, 'DSC_0001.NEF', withPreview(undevelopable(mosaic), await previewJpeg(page)));
  await root.getByRole('button', { name: 'Masks', exact: true }).first().click();
  await root.getByRole('button', { name: /Detect subject/ }).first().click();
  await expect(root.getByText(/^Active layers \(1\)/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Subject detection failed. Open Tasks for details.')).toHaveCount(0);
});

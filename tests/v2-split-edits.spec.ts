import { expect, test, type Locator } from '@playwright/test';

/**
 * Owner checklist: split frames show your edits, not the plain preview. A flat grey photo is brightened with Exposure,
 * then split across two frames; each frame's picture must be as bright as the single view's edited picture, and
 * clearly brighter than the unedited grey. Masks are part of the same edit the frames draw (`FrameImage` applies
 * `frame.edit`, masks included), so this also guards them.
 */

/** Mean brightness (0-255) of the middle of the picture drawn inside `box`. */
async function brightness(box: Locator): Promise<number> {
  return box.evaluate((element) => {
    const picture = element.querySelector('img, canvas') as HTMLImageElement | HTMLCanvasElement | null;
    if (!picture) return -1;
    if (picture instanceof HTMLImageElement && !(picture.complete && picture.naturalWidth > 0)) return -1;
    const width = picture instanceof HTMLImageElement ? picture.naturalWidth : picture.width;
    const height = picture instanceof HTMLImageElement ? picture.naturalHeight : picture.height;
    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 32;
    const context = canvas.getContext('2d')!;
    context.drawImage(picture, width * 0.4, height * 0.4, width * 0.2, height * 0.2, 0, 0, 32, 32);
    const data = context.getImageData(0, 0, 32, 32).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
    return sum / (data.length / 4);
  });
}

test('split frames draw the edited photograph, the same as the single view', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'The canvas split button is a desktop/tablet affordance; phones use the Formats panel.');
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Split edits');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();

  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200; canvas.height = 800;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#404040'; ctx.fillRect(0, 0, 1200, 800);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'grey.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);

  const single = root.getByTestId('canvas-frame');
  await expect.poll(() => brightness(single), { timeout: 30_000 }).toBeGreaterThan(0);
  const plain = await brightness(single);

  // Adjust may already be open (it is the default panel); a second press would close it.
  const advanced = root.getByRole('tab', { name: 'Advanced Edits' });
  if (!(await advanced.isVisible())) await root.getByRole('button', { name: 'Adjust' }).first().click();
  await advanced.click();
  await root.getByRole('slider', { name: 'Exposure' }).fill('2');
  await expect.poll(() => brightness(single), { timeout: 30_000 }).toBeGreaterThan(plain + 40);
  const edited = await brightness(single);

  await root.getByRole('button', { name: 'Split across 2 frames' }).click();
  const frames = root.locator('[data-testid^="split-frame-"][role="button"]');
  await expect(frames).toHaveCount(2);
  for (const index of [0, 1]) {
    const frame = root.getByTestId(`split-frame-${index}`);
    await expect.poll(() => brightness(frame), { timeout: 30_000 }).toBeGreaterThan(plain + 40);
    expect(Math.abs((await brightness(frame)) - edited), `frame ${index + 1} matches the single view`).toBeLessThan(12);
  }
});

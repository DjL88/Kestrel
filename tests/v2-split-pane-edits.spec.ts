import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';

/**
 * Split frames (Finish Line x-mask-split): each pane of a 2- or 3-frame split shows the edited picture, masks
 * included, exactly as export writes that frame. The panes' on-screen pixels are compared with the exported files.
 */

const SAMPLES: Array<[number, number]> = [[0.2, 0.25], [0.5, 0.5], [0.8, 0.75], [0.15, 0.8], [0.85, 0.2], [0.5, 0.15]];

async function openPhoto(page: Page) {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Split pane edits');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  // A wide, even-toned picture with a left-to-right ramp, so a wrong pane offset or a missing edit both show.
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1200; c.height = 400;
    const ctx = c.getContext('2d')!;
    const ramp = ctx.createLinearGradient(0, 0, 1200, 0);
    ramp.addColorStop(0, '#203040'); ramp.addColorStop(0.5, '#606060'); ramp.addColorStop(1, '#403020');
    ctx.fillStyle = ramp; ctx.fillRect(0, 0, 1200, 400);
    return c.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'split-edits.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
  await expect(root.getByTestId('canvas-frame').locator('img').first()).toBeVisible({ timeout: 30000 });
  return root;
}

/** Mean RGB of small boxes at fractions of an image. */
async function sampleImage(page: Page, src: string) {
  return page.evaluate(async ({ src, points }) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0);
    return points.map(([fx, fy]) => {
      const x = Math.round(fx * c.width) - 2; const y = Math.round(fy * c.height) - 2;
      const d = ctx.getImageData(x, y, 5, 5).data; const sum = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) { sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2]; }
      return sum.map((v) => v / (d.length / 4));
    });
  }, { src, points: SAMPLES });
}

/** What the pane shows on screen: a screenshot of the picture area inside its frame. */
async function samplePane(page: Page, pane: Locator) {
  const shot = await pane.getByTestId('image-inset-clip').screenshot({ animations: 'disabled' });
  return sampleImage(page, `data:image/png;base64,${shot.toString('base64')}`);
}

async function exportFiles(page: Page, root: Locator) {
  const dialog = page.getByRole('dialog', { name: /export/i });
  await root.getByRole('button', { name: /^Export/ }).first().click();
  await dialog.getByLabel('File format').selectOption('png');
  const downloaded = page.waitForEvent('download');
  await dialog.getByRole('button', { name: /export bundle/i }).click();
  const files = Object.entries(unzipSync(await readFile((await (await downloaded).path())!)))
    .filter(([name]) => name.endsWith('.png')).sort(([a], [b]) => a.localeCompare(b));
  return files.map(([name, bytes]) => ({ name, src: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}` }));
}

for (const count of [2, 3] as const) {
  test(`each pane of a ${count}-frame split shows the edit and mask that export writes`, async ({ page }, info) => {
    test.skip(info.project.name === 'phone', 'The split composition is edited on the desktop canvas (as in v2-split-five-frames).');
    const root = await openPhoto(page);

    // A mask: an oval over the middle of the composition, which crosses the pane seams.
    await root.getByRole('button', { name: 'Masks', exact: true }).first().click();
    await root.getByRole('button', { name: 'Oval area', exact: true }).click();

    await root.getByRole('button', { name: 'Split across 2 frames' }).click();
    if (count === 3) await root.getByRole('button', { name: 'Add a frame (3 frames)' }).click();
    const panes = root.locator('[data-testid^="split-frame-"][role="button"]');
    await expect(panes).toHaveCount(count);
    // The selected mask's coverage shows in every pane, named in words, as in the single view.
    await expect(root.getByTestId('split-composition').getByTestId('mask-coverage-guide')).toHaveCount(count);
    await expect(root.getByTestId('mask-canvas-label')).toContainText(/Round area.*overlay shown/i);
    // Hide that hatched overlay (an editor guide, never exported) before reading pixels.
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('o');
    await expect(root.getByTestId('mask-coverage-guide')).toHaveCount(0);
    await expect(root.getByTestId('mask-canvas-label')).toContainText(/overlay hidden/i);
    const settled = async () => {
      for (let i = 0; i < count; i++) await expect.poll(async () => (await panes.nth(i).locator('img').first().getAttribute('src')) ?? '').toMatch(/^blob:/);
      await expect(root.getByRole('status', { name: 'Refreshing image' })).toHaveCount(0);
    };
    const readPanes = async () => { const out = []; for (let i = 0; i < count; i++) out.push(await samplePane(page, panes.nth(i))); return out; };
    await settled();
    const before = await readPanes();

    // Brighten the oval while the split is on screen: the panes redraw with the mask edit.
    await root.getByRole('slider', { name: 'Round area Exposure' }).fill('1.5');
    const lum = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    // Inside the oval: the middle of the centre pane (3 frames) or the right of the first pane (2 frames). Outside it:
    // the lower left of the first pane.
    const [inPane, inSample] = count === 2 ? [0, 2] : [1, 1];
    await expect.poll(async () => lum((await samplePane(page, panes.nth(inPane)))[inSample]) - lum(before[inPane][inSample]),
      { message: 'the mask edit shows in the panes', timeout: 20_000 }).toBeGreaterThan(15);
    await settled();
    const shown = await readPanes();
    expect(Math.abs(lum(shown[0][3]) - lum(before[0][3])), 'outside the mask is unchanged').toBeLessThan(6);

    const files = await exportFiles(page, root);
    expect(files.map((file) => file.name)).toHaveLength(count);
    for (let i = 0; i < count; i++) {
      const exported = await sampleImage(page, files[i].src);
      for (let p = 0; p < SAMPLES.length; p++) {
        for (let ch = 0; ch < 3; ch++) {
          expect(Math.abs(exported[p][ch] - shown[i][p][ch]), `frame ${i + 1}, sample ${SAMPLES[p]}, channel ${ch}`).toBeLessThan(10);
        }
      }
    }
  });
}

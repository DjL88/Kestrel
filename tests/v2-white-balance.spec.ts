import { expect, test, type Locator, type Page } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'the eyedropper is checked on the desktop layout');
});

/** A new V2 project with one synthetic photo: a warm grey card (a mild amber cast) with a darker warm border. */
async function projectWithWarmGrey(page: Page): Promise<Locator> {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('White balance check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 160;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'rgb(120, 112, 100)'; ctx.fillRect(0, 0, 240, 160);
    ctx.fillStyle = 'rgb(176, 170, 160)'; ctx.fillRect(40, 30, 160, 100);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'warm-grey.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  await expect(root.getByTestId('canvas-frame').locator('canvas, img').first()).toBeVisible({ timeout: 30000 });
  const advanced = root.getByRole('tab', { name: 'Advanced Edits' });
  if (!(await advanced.isVisible())) await root.getByRole('button', { name: 'Adjust', exact: true }).first().click();
  await advanced.click();
  return root;
}

/** Colour spread (max minus min channel) at the centre of the shown picture. */
function centreSpread(root: Locator) {
  return root.getByTestId('canvas-frame').locator('canvas, img').first().evaluate((el) => {
    const source = el as HTMLCanvasElement | HTMLImageElement;
    const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
    const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
    if (!width || !height) return -1;
    const probe = document.createElement('canvas'); probe.width = width; probe.height = height;
    const ctx = probe.getContext('2d')!; ctx.drawImage(source, 0, 0);
    const c = ctx.getImageData(Math.floor(width / 2), Math.floor(height / 2), 1, 1).data;
    return Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
  });
}

test('?v2 white balance: the eyedropper makes a picked grey neutral, undo puts it back, Auto and As shot work too', async ({ page }) => {
  const root = await projectWithWarmGrey(page);
  await expect.poll(() => centreSpread(root)).toBeGreaterThan(12);
  const tools = root.getByTestId('white-balance-tools');
  const tint = root.locator('#slider-tint');

  // Eyedropper: click the grey card in the middle of the canvas.
  await tools.getByRole('button', { name: 'Pick neutral' }).click();
  await expect(tools.getByRole('button', { name: 'Pick neutral' })).toHaveAttribute('aria-pressed', 'true');
  await expect(tools.getByRole('status')).toContainText('should be grey or white');
  await root.getByTestId('wb-pick-layer').click();
  await expect(tools.getByRole('status')).toHaveText('White balance set. Undo puts it back.');
  await expect.poll(() => centreSpread(root), { timeout: 15000 }).toBeLessThan(4);
  await expect(tint).not.toHaveValue('0');

  // One undo step restores the cast.
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect.poll(() => centreSpread(root), { timeout: 15000 }).toBeGreaterThan(12);

  // Auto estimates the light from the whole (uniformly warm) picture.
  await tools.getByRole('button', { name: 'Auto' }).click();
  await expect.poll(() => centreSpread(root), { timeout: 15000 }).toBeLessThan(6);

  // As shot clears it again.
  await tools.getByRole('button', { name: 'As shot' }).click();
  await expect.poll(() => centreSpread(root), { timeout: 15000 }).toBeGreaterThan(12);
  await expect(tint).toHaveValue('0');

  // Esc leaves the eyedropper without changing anything.
  await tools.getByRole('button', { name: 'Pick neutral' }).click();
  await page.keyboard.press('Escape');
  await expect(tools.getByRole('button', { name: 'Pick neutral' })).toHaveAttribute('aria-pressed', 'false');
  await expect(root.getByTestId('wb-pick-layer')).toHaveCount(0);
});

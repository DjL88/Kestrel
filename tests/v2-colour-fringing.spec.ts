import { expect, test, type Locator, type Page } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'the V2 phone layout is checked in a later slice');
});

/** A new V2 project with one synthetic photo: white, with a small black square near the top-left corner. */
async function projectWithPhoto(page: Page): Promise<Locator> {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Fringing check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 800, 600);
    ctx.fillStyle = '#000000'; ctx.fillRect(60, 60, 60, 60);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'fringe-1.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  await expect(root.getByTestId('canvas-frame').locator('canvas, img').first()).toBeVisible({ timeout: 30000 });
  const advanced = root.getByRole('tab', { name: 'Advanced Edits' });
  if (!(await advanced.isVisible())) await root.getByRole('button', { name: 'Adjust', exact: true }).first().click();
  await advanced.click();
  return root;
}

/** How far red differs from green, summed along a row that crosses the square's left and right edges. */
function fringe(root: Locator) {
  return root.getByTestId('canvas-frame').locator('canvas, img').first().evaluate((el) => {
    const source = el as HTMLCanvasElement | HTMLImageElement;
    const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
    const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
    if (!width || !height) return -1;
    const probe = document.createElement('canvas'); probe.width = width; probe.height = height;
    const ctx = probe.getContext('2d')!; ctx.drawImage(source, 0, 0);
    const row = ctx.getImageData(0, Math.round(height * 0.15), Math.round(width * 0.2), 1).data;
    let sum = 0; for (let i = 0; i < row.length; i += 4) sum += Math.abs(row[i] - row[i + 1]);
    return sum;
  });
}

test('?v2 colour fringing: the red slider moves red against green at an edge near the corner, Reset puts it back, and Auto says when it cannot measure', async ({ page }) => {
  const root = await projectWithPhoto(page);
  const control = root.getByTestId('colour-fringing');
  await expect(control).toBeVisible();
  await expect.poll(async () => fringe(root)).toBeGreaterThanOrEqual(0);
  const before = await fringe(root);
  expect(before).toBeLessThan(20);
  await control.getByRole('slider', { name: 'Red/cyan' }).fill('100');
  await expect.poll(async () => fringe(root), { timeout: 15000 }).toBeGreaterThan(before + 100);
  // A single square has too few strong edges to measure: Auto says so and leaves the slider alone.
  await control.getByRole('button', { name: 'Measure colour fringing on this photo' }).click();
  await expect(control.getByRole('status')).toHaveText(/Too few strong edges/);
  await expect(control.getByRole('slider', { name: 'Red/cyan' })).toHaveValue('100');
  await control.getByRole('button', { name: 'Reset fringing' }).click();
  await expect.poll(async () => fringe(root), { timeout: 15000 }).toBeLessThan(before + 5);
});

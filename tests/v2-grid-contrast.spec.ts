import { expect, test, type Page } from '@playwright/test';

// Dave, 27 Nov: "the 3x3/4x4 grid is hard to see on this photo" (a busy mid-grey burrow). On a flat mid-grey photo the
// grid shows a light line and a dark edge beside it, about one screen pixel wide, at Fit and zoomed in.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The grid toggle sits in the desktop zoom bar.');
});

async function importGrey(page: Page) {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Grid check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1500; canvas.height = 1000;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, 1500, 1000);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'grey.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1, { timeout: 30000 });
  await expect(root.getByTestId('zoom-percent')).not.toHaveText('100%', { timeout: 30000 });
  return root;
}

/** Brightness across a horizontal run of screen pixels through the first vertical grid line. */
async function across(page: Page) {
  const line = page.getByTestId('composition-grid').locator('[data-grid-layer="line"] line').first();
  const svg = (await page.getByTestId('composition-grid').boundingBox())!;
  const x1 = Number(await line.getAttribute('x1'));
  const stage = (await page.getByTestId('canvas-stage').boundingBox())!;
  const at = { x: svg.x + (x1 / 100) * svg.width, y: Math.max(svg.y, stage.y) + 40 };
  const shot = await page.screenshot({ clip: { x: Math.round(at.x) - 10, y: Math.round(at.y), width: 20, height: 1 } });
  return page.evaluate(async (base64) => {
    const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
    const ctx = Object.assign(document.createElement('canvas'), { width: image.width, height: image.height }).getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, image.width, 1).data;
    return Array.from({ length: image.width }, (_, i) => Math.round((data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3));
  }, shot.toString('base64'));
}

test('the composition grid shows as a light line with a dark edge on mid-grey, thin at Fit and zoomed in', async ({ page }) => {
  const root = await importGrey(page);
  await root.getByTestId('grid-toggle').click();
  await expect(root.getByTestId('composition-grid')).toBeVisible();
  const check = async (label: string) => {
    const row = await across(page);
    const light = row.filter((v) => v >= 200).length;
    const dark = row.filter((v) => v <= 90).length;
    expect(light, `${label}: a light line on mid-grey (${row.join(' ')})`).toBeGreaterThanOrEqual(1);
    expect(light, `${label}: the light line stays thin`).toBeLessThanOrEqual(3);
    expect(dark, `${label}: a darker edge beside it`).toBeGreaterThanOrEqual(1);
    expect(dark, `${label}: the edge stays thin`).toBeLessThanOrEqual(4);
  };
  await check('Fit');
  for (let step = 0; step < 6; step += 1) await root.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.waitForTimeout(300);
  await check('zoomed in');
});

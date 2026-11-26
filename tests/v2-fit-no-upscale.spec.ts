import { expect, test, type Page } from '@playwright/test';

// Decision 11.2: Fit fills the space only up to the photo's own pixels. A photo smaller than the screen shows at 100%
// with space round it, never enlarged; a photo larger than the screen still fills the space (below 100%).

async function openPhoto(page: Page, width: number, height: number) {
  await page.goto('/?v2');
  const studio = page.locator('.inflight-v2');
  await expect(studio.getByText('No projects yet')).toBeVisible({ timeout: 30_000 });
  await studio.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Fit size');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const png = await page.evaluate(([w, h]) => {
    const image = document.createElement('canvas');
    image.width = w; image.height = h;
    const ctx = image.getContext('2d')!;
    ctx.fillStyle = '#586b82'; ctx.fillRect(0, 0, w, h);
    return image.toDataURL('image/png').split(',')[1];
  }, [width, height]);
  const picker = page.waitForEvent('filechooser');
  await studio.getByRole('button', { name: 'Import', exact: true }).click();
  await (await picker).setFiles([{ name: `fit-${width}x${height}.png`, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
  await expect(studio.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  await expect(studio.getByTestId('canvas-frame')).toBeVisible();
  return studio;
}
const zoomPercent = async (page: Page) => Number((await page.getByTestId('zoom-percent').innerText()).replace('%', ''));

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'A large desktop screen is where a small photo would be enlarged.');
});

test('on a large screen a small photo shows at 100% at Fit, never enlarged', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openPhoto(page, 600, 400);
  await expect.poll(() => zoomPercent(page)).toBe(100);
  const frame = (await page.getByTestId('canvas-frame').boundingBox())!;
  expect(frame.width).toBeLessThanOrEqual(600 + 1);
  expect(frame.height).toBeLessThanOrEqual(400 + 1);
});

test('a photo larger than the screen still fits below 100%', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openPhoto(page, 3000, 2000);
  await expect.poll(() => zoomPercent(page)).toBeLessThan(100);
  const stage = (await page.getByTestId('canvas-stage').boundingBox())!;
  const frame = (await page.getByTestId('canvas-frame').boundingBox())!;
  expect(frame.x + frame.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
});

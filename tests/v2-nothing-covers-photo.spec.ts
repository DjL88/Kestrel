import { expect, test, type Locator, type Page } from '@playwright/test';

// Dave, 27 Nov: "Nothing should cover the image." Notes and controls sit in the status line under the canvas, never on
// the photo; the zoom-to-eye note goes after about six seconds instead of staying for good.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The zoom menu is a desktop control; the status line is the same on every screen.');
});

const overlaps = async (a: Locator, b: Locator) => {
  const [x, y] = [(await a.boundingBox())!, (await b.boundingBox())!];
  return x.x < y.x + y.width && x.x + x.width > y.x && x.y < y.y + y.height && x.y + x.height > y.y;
};

async function importGrey(page: Page) {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Cover check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 3000; canvas.height = 2000;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#777'; ctx.fillRect(0, 0, 3000, 2000);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'grey.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1, { timeout: 30000 });
  await expect(root.getByTestId('zoom-percent')).not.toHaveText('100%', { timeout: 30000 });
  return root;
}

test('the zoom note sits in the status line under the canvas, not on the photo, and goes after a few seconds', async ({ page }) => {
  const root = await importGrey(page);
  const status = root.getByTestId('canvas-status');
  const stage = root.getByTestId('canvas-stage');
  await expect(status).toBeVisible();
  expect(await overlaps(status, stage), 'the status line is under the canvas, not over it').toBe(false);

  const zoom = root.getByTestId('zoom-percent');
  await zoom.click();
  await expect(root.getByTestId('zoom-menu-eye')).toHaveText(/Zoom to centre/, { timeout: 30000 });
  await root.getByTestId('zoom-menu-eye').click();
  const note = status.getByTestId('eye-note');
  await expect(note).toContainText('No clear subject, so zoomed to the centre.');
  // The photo is only ever seen inside the stage (zoomed in, the rest is scrolled out of view).
  expect(await overlaps(note, stage), 'the note covers the photo').toBe(false);

  // Held while the pointer is on it, so it can be read; gone a few seconds after it leaves.
  await note.hover();
  await page.waitForTimeout(7000);
  await expect(note).toBeVisible();
  await page.mouse.move(5, 5);
  await expect(note).toHaveCount(0, { timeout: 9000 });
});

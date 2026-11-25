import { expect, test } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop zoom bar.');
});

test('?v2 the zoom percentage opens Fit, 100% and Zoom to eye; an eye-less picture says so and the view stays put', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Zoom check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  // A plain grey picture three times the stage: no subject and no eye.
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 3000; canvas.height = 2000;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#777'; ctx.fillRect(0, 0, 3000, 2000);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'grey.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1, { timeout: 30000 });

  const zoom = root.getByTestId('zoom-percent');
  await expect(zoom).not.toHaveText('100%', { timeout: 30000 });
  const fit = await zoom.textContent();
  await zoom.click();
  const menu = root.getByTestId('zoom-menu');
  await expect(menu.getByRole('menuitem')).toHaveText([/Fit to screen/, /100% \(actual pixels\)/, /Zoom to eye/]);
  await expect(root.getByTestId('zoom-menu-fit')).toContainText('Now');
  await root.getByTestId('zoom-menu-100').click();
  await expect(zoom).toHaveText('100%');
  await expect(menu).toHaveCount(0);
  // Escape closes the menu without changing the zoom.
  await zoom.click();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(zoom).toHaveText('100%');
  await zoom.click();
  await root.getByTestId('zoom-menu-fit').click();
  await expect(zoom).toHaveText(fit!);
  // Zoom to eye on a picture with no eye: it says so in words and leaves the zoom alone.
  await zoom.click();
  await root.getByTestId('zoom-menu-eye').click();
  await expect(root.getByTestId('eye-note')).toContainText(/No eye stood out clearly|not ready/, { timeout: 30000 });
  await expect(zoom).toHaveText(fit!);
  await root.getByTestId('eye-note').getByRole('button', { name: 'Dismiss' }).click();
  await expect(root.getByTestId('eye-note')).toHaveCount(0);
});

test('?v2 Zoom to eye moves the view to a clear eye on a synthetic subject and zooms in', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Eye check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  // A pale sky, a large warm-brown body to the right, and one dark round eye with a catchlight near its top right.
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 2400; canvas.height = 1600;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#cfe0ee'; ctx.fillRect(0, 0, 2400, 1600);
    ctx.fillStyle = '#8a5a2b'; ctx.beginPath(); ctx.ellipse(1500, 900, 600, 420, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#9b6a35'; ctx.beginPath(); ctx.ellipse(1850, 560, 240, 210, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0b0b0b'; ctx.beginPath(); ctx.arc(1930, 520, 34, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(1940, 510, 8, 0, Math.PI * 2); ctx.fill();
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'bird.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1, { timeout: 30000 });
  const zoom = root.getByTestId('zoom-percent');
  await expect(zoom).not.toHaveText('100%', { timeout: 30000 });
  await page.waitForTimeout(1500);
  await zoom.click();
  await root.getByTestId('zoom-menu-eye').click();
  const note = root.getByTestId('eye-note');
  await expect(note).toContainText(/Zoomed to/, { timeout: 30000 });
  await expect(zoom).toHaveText('100%');
  // The eye is now near the middle of the stage.
  const stage = await root.getByTestId('canvas-stage').boundingBox();
  const eye = await page.evaluate(() => {
    const frame = document.querySelector('[data-testid="canvas-frame"]')!;
    const pics = [...frame.querySelectorAll('img, canvas')] as (HTMLImageElement | HTMLCanvasElement)[];
    const pic = pics.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
    const r = pic.getBoundingClientRect();
    return { x: r.left + (1930 / 2400) * r.width, y: r.top + (520 / 1600) * r.height };
  });
  expect(Math.abs(eye.x - (stage!.x + stage!.width / 2))).toBeLessThan(stage!.width * 0.2);
  expect(Math.abs(eye.y - (stage!.y + stage!.height / 2))).toBeLessThan(stage!.height * 0.2);
});

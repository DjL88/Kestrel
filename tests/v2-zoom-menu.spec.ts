import { expect, test } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop zoom bar.');
});

test('?v2 the zoom percentage opens Fit, 100% and Zoom to eye; a picture with no eye or subject zooms to the centre', async ({ page }) => {
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
  // A PNG carries no camera focus point, so Zoom to focus point is offered but disabled, with the reason.
  await expect(menu.getByRole('menuitem')).toHaveText([/Fit to screen/, /100% \(actual pixels\)/, /Zoom to focus point/, /Zoom to (eye|centre)/]);
  await expect(root.getByTestId('zoom-menu-focus-point')).toBeDisabled();
  await expect(root.getByTestId('zoom-menu-focus-point')).toHaveAttribute('title', 'This file does not say where the camera focused.');
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
  // No eye and no subject: once the look-ahead has run, the menu offers the centre, and it zooms there at 100%.
  await zoom.click();
  await expect(root.getByTestId('zoom-menu-eye')).toHaveText(/Zoom to centre/, { timeout: 30000 });
  await root.getByTestId('zoom-menu-eye').click();
  await expect(root.getByTestId('eye-note')).toContainText('No clear subject, so zoomed to the centre.');
  await expect(zoom).toHaveText('100%');
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
  await zoom.click();
  // Wait for the look-ahead's answer (the menu says Zoom to eye once it found one), not a fixed time: on a slow runner
  // the subject search can take longer, and clicking before it answered zoomed to the centre.
  await expect(root.getByTestId('zoom-menu-eye')).toHaveText(/Zoom to eye/, { timeout: 30000 });
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

async function importPicture(page: import('@playwright/test').Page, name: string, draw: string) {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill(name);
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const png = await page.evaluate((source) => {
    const canvas = document.createElement('canvas'); canvas.width = 2400; canvas.height = 1600;
    const ctx = canvas.getContext('2d')!;
    new Function('ctx', source)(ctx);
    return canvas.toDataURL('image/png').split(',')[1];
  }, draw);
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: `${name}.png`, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1, { timeout: 30000 });
  await expect(root.getByTestId('zoom-percent')).not.toHaveText('100%', { timeout: 30000 });
  return root;
}

/** Where a point of the picture (0 to 1 across it) is now, against the middle of the stage, in shares of the stage. */
async function offCentre(page: import('@playwright/test').Page, at: { x: number; y: number }) {
  return page.evaluate((point) => {
    const stage = document.querySelector('[data-testid="canvas-stage"]')!.getBoundingClientRect();
    const frame = document.querySelector('[data-testid="canvas-frame"]')!;
    const pics = [...frame.querySelectorAll('img, canvas')] as (HTMLImageElement | HTMLCanvasElement)[];
    const r = pics.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0].getBoundingClientRect();
    return {
      x: Math.abs(r.left + point.x * r.width - (stage.left + stage.width / 2)) / stage.width,
      y: Math.abs(r.top + point.y * r.height - (stage.top + stage.height / 2)) / stage.height,
    };
  }, at);
}

test('?v2 100% from Fit lands on the middle of a plain picture, not somewhere else', async ({ page }) => {
  const root = await importPicture(page, 'Centre check', "ctx.fillStyle = '#777'; ctx.fillRect(0, 0, 2400, 1600);");
  const zoom = root.getByTestId('zoom-percent');
  await zoom.click();
  await root.getByTestId('zoom-menu-100').click();
  await expect(zoom).toHaveText('100%');
  const off = await offCentre(page, { x: 0.5, y: 0.5 });
  expect(off.x).toBeLessThan(0.05);
  expect(off.y).toBeLessThan(0.05);
});

test('?v2 100% goes to the subject found in the background, with no wait', async ({ page }) => {
  const root = await importPicture(page, 'Subject check', `
    ctx.fillStyle = '#cfe0ee'; ctx.fillRect(0, 0, 2400, 1600);
    ctx.fillStyle = '#8a5a2b'; ctx.beginPath(); ctx.ellipse(1500, 900, 600, 420, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#9b6a35'; ctx.beginPath(); ctx.ellipse(1850, 560, 240, 210, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0b0b0b'; ctx.beginPath(); ctx.arc(1930, 520, 34, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(1940, 510, 8, 0, Math.PI * 2); ctx.fill();`);
  const zoom = root.getByTestId('zoom-percent');
  // The menu names the eye once the background search has finished: nothing is searched when 100% is chosen.
  await zoom.click();
  await expect(root.getByTestId('zoom-menu-eye')).toHaveAttribute('data-zoom-focus', /^(eye|subject)$/, { timeout: 30000 });
  await root.getByTestId('zoom-menu-100').click();
  await expect(zoom).toHaveText('100%');
  // The middle of the view is on the bird (right of the picture's middle), not the picture's centre.
  const middle = await page.evaluate(() => {
    const stage = document.querySelector('[data-testid="canvas-stage"]')!.getBoundingClientRect();
    const frame = document.querySelector('[data-testid="canvas-frame"]')!;
    const pics = [...frame.querySelectorAll('img, canvas')] as (HTMLImageElement | HTMLCanvasElement)[];
    const r = pics.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0].getBoundingClientRect();
    return { x: (stage.left + stage.width / 2 - r.left) / r.width, y: (stage.top + stage.height / 2 - r.top) / r.height };
  });
  expect(middle.x).toBeGreaterThan(0.55);
  expect(middle.y).toBeLessThan(0.7);
});

test('?v2 a mouse wheel notch zooms in at the pointer, and Ctrl+wheel (a trackpad pinch) zooms too', async ({ page }) => {
  const root = await importPicture(page, 'Wheel check', "ctx.fillStyle = '#777'; ctx.fillRect(0, 0, 2400, 1600); ctx.fillStyle = '#222'; ctx.fillRect(1700, 300, 200, 200);");
  const zoom = root.getByTestId('zoom-percent');
  const before = Number((await zoom.textContent())!.replace('%', ''));
  const stage = (await root.getByTestId('canvas-stage').boundingBox())!;
  const target = await page.evaluate(() => {
    const frame = document.querySelector('[data-testid="canvas-frame"]')!;
    const r = frame.getBoundingClientRect();
    return { x: r.left + (1800 / 2400) * r.width, y: r.top + (400 / 1600) * r.height };
  });
  // A mouse notch: Chromium reports the legacy wheel delta in steps of 120.
  await page.evaluate((at) => {
    const stageEl = document.querySelector('[data-testid="canvas-stage"]')!;
    const event = new WheelEvent('wheel', { deltaY: -100, deltaMode: 0, clientX: at.x, clientY: at.y, bubbles: true, cancelable: true });
    Object.defineProperty(event, 'wheelDeltaY', { value: 120 });
    stageEl.dispatchEvent(event);
  }, target);
  await expect.poll(async () => Number((await zoom.textContent())!.replace('%', ''))).toBeGreaterThan(before);
  // The square under the pointer stays under it.
  const after = await page.evaluate(() => {
    const frame = document.querySelector('[data-testid="canvas-frame"]')!;
    const r = frame.getBoundingClientRect();
    return { x: r.left + (1800 / 2400) * r.width, y: r.top + (400 / 1600) * r.height };
  });
  expect(Math.abs(after.x - target.x)).toBeLessThan(stage.width * 0.03);
  expect(Math.abs(after.y - target.y)).toBeLessThan(stage.height * 0.03);
  const mid = Number((await zoom.textContent())!.replace('%', ''));
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -60);
  await page.keyboard.up('Control');
  await expect.poll(async () => Number((await zoom.textContent())!.replace('%', ''))).toBeGreaterThan(mid);
});

test('?v2 Canvas only hides the header, rail, panels and filmstrip, and one button or L brings them back', async ({ page }) => {
  const root = await importPicture(page, 'Canvas only', "ctx.fillStyle = '#777'; ctx.fillRect(0, 0, 2400, 1600);");
  const strip = root.getByRole('listbox', { name: 'Project photographs' });
  await expect(strip).toBeVisible();
  await root.getByTestId('canvas-only-toggle').click();
  await expect(strip).toHaveCount(0);
  await expect(root.getByTestId('canvas-stage')).toBeVisible();
  await root.getByTestId('canvas-only-exit').click();
  await expect(strip).toBeVisible();
  await root.getByTestId('canvas-stage').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('l');
  await expect(strip).toHaveCount(0);
  await page.keyboard.press('l');
  await expect(strip).toBeVisible();
});

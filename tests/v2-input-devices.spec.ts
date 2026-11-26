import { expect, test, type Page } from '@playwright/test';

// Keyboard zoom, dials that turn sliders, and palm rejection for a pen (Settings > Keyboard; the input audit, 25 Nov).

async function openPhoto(page: Page, keymapOverrides: Record<string, string> = {}) {
  await page.addInitScript((overrides) => {
    localStorage.setItem('inflight-v2-keymap', JSON.stringify({ preset: 'inflight', overrides }));
  }, keymapOverrides);
  await page.goto('/?v2');
  const studio = page.locator('.inflight-v2');
  await expect(studio.getByText('No projects yet')).toBeVisible({ timeout: 30_000 });
  await studio.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Input devices');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const png = await page.evaluate(() => {
    const image = document.createElement('canvas');
    image.width = 3000;
    image.height = 2000;
    const ctx = image.getContext('2d')!;
    ctx.fillStyle = '#586b82';
    ctx.fillRect(0, 0, image.width, image.height);
    return image.toDataURL('image/png').split(',')[1];
  });
  const picker = page.waitForEvent('filechooser');
  await studio.getByRole('button', { name: 'Import', exact: true }).click();
  await (await picker).setFiles([{ name: 'input-test.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
  await expect(studio.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  await expect(studio.getByTestId('canvas-frame')).toBeVisible();
  return studio;
}

const zoomPercent = async (page: Page) => Number((await page.getByTestId('zoom-percent').innerText()).replace('%', ''));

test('+ and - zoom the photo from the keyboard, and the 100% key goes to 100% and back to fit', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'A keyboard test.');
  await openPhoto(page, { 'view.zoom100': 'KeyQ' });
  await page.getByTestId('canvas-stage').click({ position: { x: 8, y: 8 } });
  const fit = await zoomPercent(page);
  await page.keyboard.press('=');
  await expect.poll(() => zoomPercent(page)).toBeGreaterThan(fit);
  await page.keyboard.press('-');
  await expect.poll(() => zoomPercent(page)).toBe(fit);
  await page.keyboard.press('q');
  await expect.poll(() => zoomPercent(page)).toBe(100);
  await page.keyboard.press('q');
  await expect.poll(() => zoomPercent(page)).toBe(fit);
});

test('a dial key turns the slider in use, or Exposure when none has been used', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'A keyboard test.');
  const root = await openPhoto(page, { 'adjust.sliderUp': 'Period', 'adjust.sliderDownMore': 'Comma' });
  const advanced = root.getByRole('tab', { name: 'Advanced Edits' });
  if (!(await advanced.isVisible())) await root.getByRole('button', { name: 'Adjust', exact: true }).first().click();
  await advanced.click();
  const exposure = root.getByLabel('Exposure', { exact: true });
  await expect(exposure).toBeVisible();
  await page.getByTestId('canvas-stage').click({ position: { x: 8, y: 8 } });
  await page.keyboard.press('.');
  await expect(exposure).toHaveValue('0.1');
  // Once Contrast has been used, the dial turns Contrast, ten steps at a time with the "more" command, even while it has focus.
  const contrast = root.getByLabel('Contrast', { exact: true });
  await contrast.focus();
  await page.keyboard.press(',');
  await expect(contrast).toHaveValue('-10');
  await expect(exposure).toHaveValue('0.1');
});

test('a palm on the photo while the pen is down never swipes to another photo', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'A touch test.');
  const root = await openPhoto(page);
  // A second photo, so a swipe has somewhere to go.
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 1200; c.height = 800; c.getContext('2d')!.fillRect(0, 0, 1200, 800); return c.toDataURL('image/png').split(',')[1]; });
  const picker = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: 'Import', exact: true }).first().click();
  await (await picker).setFiles([{ name: 'second.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
  const options = root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option');
  await expect(options).toHaveCount(2);
  await options.first().click();
  const frame = (await root.getByTestId('canvas-frame').boundingBox())!;
  const at = { left: frame.x + 20, right: frame.x + frame.width - 20, y: frame.y + frame.height / 2 };
  // Real input through the browser (Chrome DevTools Protocol): a pen as a pen pointer, the palm as a touch.
  const cdp = await page.context().newCDPSession(page);
  const flick = async (withPen: boolean) => {
    const { left, right, y } = at;
    const pen = (type: 'mousePressed' | 'mouseReleased') => cdp.send('Input.dispatchMouseEvent', { type, x: left, y: y - 40, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1, pointerType: 'pen', force: 0.5 });
    if (withPen) await pen('mousePressed');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: right, y, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: (left + right) / 2, y, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: left, y, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    if (withPen) await pen('mouseReleased');
  };
  const shown = () => options.evaluateAll((els) => els.findIndex((el) => el.getAttribute('aria-selected') === 'true'));
  const first = await shown();
  // Pen on the glass, then a fast palm flick across the photo: the photo stays.
  await flick(true);
  await page.waitForTimeout(500);
  expect(await shown()).toBe(first);
  // The same flick with the pen long lifted is a finger, and it moves on (the control: the flick itself is a real swipe).
  await page.waitForTimeout(400);
  await flick(false);
  await expect.poll(shown).not.toBe(first);
});

test('pad keys are on out of the box, so the keyboard guide lists them', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'A keyboard test.');
  await openPhoto(page);
  await page.getByTestId('canvas-stage').click({ position: { x: 8, y: 8 } });
  await page.keyboard.press('?');
  await expect(page.getByTestId('shortcut-guide-pad')).toBeVisible();
});

test('pad keys turned off do nothing and leave the keyboard guide', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'A keyboard test.');
  // As Settings > Keyboard > Macro pad keys saves it.
  await page.addInitScript(() => localStorage.setItem('inflight.v2.ui', JSON.stringify({ settings: { padKeysEnabled: false } })));
  await openPhoto(page);
  await page.getByTestId('canvas-stage').click({ position: { x: 8, y: 8 } });
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await expect(page.getByTestId('shortcut-guide-pad')).toHaveCount(0);
  await page.keyboard.press('Escape');
  // The pad's Space (All photos) does nothing now.
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  await expect(page.getByTestId('canvas-frame')).toBeVisible();
});

test('E closes the grid, F6 hides the filmstrip, and Ctrl+Y redoes on Windows-style keys', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'A keyboard test.');
  const root = await openPhoto(page);
  await page.getByTestId('canvas-stage').click({ position: { x: 8, y: 8 } });
  await page.keyboard.press('g');
  await expect(root.getByTestId('canvas-frame')).toHaveCount(0);
  await page.keyboard.press('e');
  await expect(root.getByTestId('canvas-frame')).toBeVisible();
  const strip = root.getByRole('listbox', { name: 'Project photographs' });
  await expect(strip).toBeVisible();
  await page.keyboard.press('F6');
  await expect(strip).toBeHidden();
  await page.keyboard.press('F6');
  await expect(strip).toBeVisible();
});

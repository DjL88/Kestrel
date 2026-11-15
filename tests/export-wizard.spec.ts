import { expect, test } from '@playwright/test';
import { openExportDialog } from './helpers';

test('export wizard: platform, size, position, then export', async ({ page }) => {
  await page.goto('/');
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 900; canvas.height = 600;
    const c = canvas.getContext('2d')!;
    const g = c.createLinearGradient(0, 0, 900, 600); g.addColorStop(0, '#23405a'); g.addColorStop(1, '#d9a45c');
    c.fillStyle = g; c.fillRect(0, 0, 900, 600);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByTestId('quick-edit-input').setInputFiles({ name: 'wiz.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await openExportDialog(page);

  // 1. Where to. Nothing can be skipped to before a place is chosen.
  const steps = page.getByRole('list', { name: 'Export steps' });
  await expect(steps.getByRole('listitem').first()).toHaveAttribute('aria-current', 'step');
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Instagram' }).click();

  // 2. Size. Keyboard focus starts at the heading, then moves to the first option.
  await expect(page.getByRole('heading', { name: 'Instagram: which size?' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('region', { name: 'Instagram sizes' }).getByRole('checkbox').first()).toBeFocused();
  await expect(page.getByRole('region', { name: 'Instagram sizes' })).toBeVisible();
  const next = page.getByRole('button', { name: 'Next', exact: true });
  await page.getByRole('checkbox', { name: /Post · 4:5/ }).check();
  await next.click();

  // 3. Position, with the preview, zoom and turn right there.
  await expect(page.getByRole('region', { name: 'Position' })).toBeVisible();
  const preview = page.getByRole('img', { name: /as Post · 4:5/ });
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((canvas: HTMLCanvasElement) => Number((canvas.width / canvas.height).toFixed(2)))).toBe(0.8);
  const snapshot = await preview.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await page.getByRole('checkbox', { name: 'Show text overlay' }).check();
  await page.getByLabel('Title', { exact: true }).fill('Kestrel at dusk');
  await page.getByLabel('Location', { exact: true }).fill('Herefordshire');
  await page.getByLabel('Alignment').selectOption('centre');
  await expect.poll(() => preview.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).not.toBe(snapshot);
  await page.getByRole('button', { name: /Turn Post · 4:5 on its side/ }).click();
  await expect.poll(() => page.getByRole('img', { name: /as Post · 5:4/ }).evaluate((canvas: HTMLCanvasElement) => Number((canvas.width / canvas.height).toFixed(2)))).toBe(1.25);
  await next.click();

  // 4. Review, back and forward keep the choices, then export.
  await expect(page.getByRole('heading', { name: 'Ready to export' })).toBeFocused();
  await expect(page.getByRole('region', { name: 'Ready to export' })).toBeVisible();
  await expect(page.getByText('Post · 5:4').first()).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Kestrel at dusk');
  await page.getByRole('dialog').getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Position/ })).toBeFocused();
  await expect(page.getByRole('region', { name: 'Position' })).toBeVisible();
  await next.click();
  await page.getByRole('button', { name: 'Prepare 1 file' }).click();
  await expect(page.getByRole('status').filter({ hasText: '1 file ready' })).toBeVisible({ timeout: 30000 });
});

async function openWizard(page: import('@playwright/test').Page) {
  await page.goto('/');
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 900; canvas.height = 600;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#334'; c.fillRect(0, 0, 900, 600);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByTestId('quick-edit-input').setInputFiles({ name: 'w.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await openExportDialog(page);
}

test('the wizard ignores earlier saved choices and shows the size that was picked', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kestrel.lastExport.v2', JSON.stringify(['tt-story', 'th-34', 'master'])));
  await openWizard(page);
  await page.getByRole('button', { name: 'Instagram' }).click();
  await page.getByRole('checkbox', { name: /Square · 1:1/ }).check();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Position · Square · 1:1/ })).toBeVisible();
  await expect(page.getByText('TikTok')).toHaveCount(0);
  await expect(page.getByText(/1 of 1\)/)).toBeVisible();
});

test('on a short screen the step scrolls and Next stays in view', async ({ page }) => {
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 480 });
  await openWizard(page);
  await page.getByRole('button', { name: 'Instagram' }).click();
  await page.getByRole('checkbox', { name: /Post · 4:5/ }).check();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  const next = page.getByRole('button', { name: 'Next', exact: true });
  await expect(next).toBeVisible();
  const height = page.viewportSize()!.height;
  const box = (await next.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(height);
  // The part below the picture is reachable by scrolling, and stays above the buttons.
  const fits = page.getByLabel('How it fits');
  await fits.scrollIntoViewIfNeeded();
  const fitsBox = (await fits.boundingBox())!;
  expect(fitsBox.y + fitsBox.height).toBeLessThanOrEqual(box.y + 1);
  const scrollOffset = (name: RegExp) => page.getByRole('heading', { name })
    .evaluate((element) => element.closest('section')!.parentElement!.scrollTop);
  await expect.poll(() => scrollOffset(/^Position/)).toBeGreaterThan(0);
  await next.click();
  await expect.poll(() => scrollOffset(/^Ready to export/)).toBe(0);
});

test('the wizard buttons are never cropped', async ({ page }) => {
  await openWizard(page);
  await page.getByRole('button', { name: 'Instagram' }).click();
  await page.getByRole('checkbox', { name: /Post · 4:5/ }).check();
  for (const label of ['Back', 'Next']) {
    const button = page.getByRole('dialog').getByRole('button', { name: label, exact: true });
    const whole = await button.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const dialog = element.closest('section')!.getBoundingClientRect();
      // Every corner of the button must be what the user sees there, not a clipped-away edge.
      const corners = [[box.left + 9, box.top + 9], [box.right - 9, box.top + 9], [box.left + 9, box.bottom - 2], [box.right - 9, box.bottom - 2]];
      return { seen: corners.every(([x, y]) => element.contains(document.elementFromPoint(x, y))), inside: box.bottom <= dialog.bottom - 8 };
    });
    expect(whole, `${label} is fully visible`).toEqual({ seen: true, inside: true });
  }
});

test('with several sizes chosen, every position step matches its own size', async ({ page }) => {
  await openWizard(page);
  await page.getByRole('button', { name: 'Instagram' }).click();
  // Chosen out of order on purpose.
  for (const name of [/Story or Reel cover · 9:16/, /Square · 1:1/, /Post · 4:5/]) await page.getByRole('checkbox', { name }).check();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  const shapes: [RegExp, number, string][] = [[/Post · 4:5/, 0.8, '1 of 3'], [/Square · 1:1/, 1, '2 of 3'], [/Story or Reel cover · 9:16/, 0.56, '3 of 3']];
  for (const [label, ratio, counter] of shapes) {
    const heading = page.getByRole('heading', { name: label });
    await expect(heading).toContainText(counter);
    await expect(heading).toBeFocused();
    const picture = page.getByRole('img', { name: new RegExp(`as ${label.source}`) });
    await expect.poll(() => picture.evaluate((canvas: HTMLCanvasElement) => Number((canvas.width / canvas.height).toFixed(2)))).toBe(ratio);
    await page.getByRole('dialog').getByRole('button', { name: /^Next/ }).click();
  }
  await expect(page.getByRole('region', { name: 'Ready to export' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Prepare 3 files' })).toBeVisible();
});

test('file names: my own name and a number, shown as an example and used for the download', async ({ page }) => {
  await openWizard(page);
  await page.getByRole('button', { name: 'Instagram' }).click();
  await page.getByRole('checkbox', { name: /Post · 4:5/ }).check();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText(/Example: .*w_4x5\.jpg/)).toBeVisible();
  await page.getByLabel('Use my own name and a number').check();
  await page.getByLabel('Name', { exact: true }).fill('Red Kite');
  await page.getByRole('combobox', { name: 'Number' }).selectOption('sequence');
  await expect(page.getByText(/Example: .*Red-Kite_4x5\.jpg/)).toBeVisible();
  await page.getByLabel('Show text overlay').check();
  await expect(page.getByText('There are no matching shooting details')).toBeVisible();
  await page.getByRole('button', { name: 'Prepare 1 file' }).click();
  await expect(page.getByRole('status').filter({ hasText: '1 file ready' })).toBeVisible({ timeout: 30000 });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/Red-Kite_4x5\.jpg$/);
});

test('details overlay: the photo’s own camera and settings are printed on the preview', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles('tests/fixtures/exif-photo.jpg');
  await openExportDialog(page);
  await page.getByRole('button', { name: 'Instagram' }).click();
  await page.getByRole('checkbox', { name: /Post · 4:5/ }).check();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  const picture = page.getByRole('img', { name: /as Post · 4:5/ });
  const bottomBrightness = () => picture.evaluate((canvas: HTMLCanvasElement) => {
    const c = canvas.getContext('2d')!;
    const d = c.getImageData(0, Math.floor(canvas.height * 0.8), canvas.width, Math.floor(canvas.height * 0.2)).data;
    let sum = 0; for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
    return sum / (d.length / 4);
  });
  await expect(picture).toBeVisible();
  await page.waitForTimeout(500);
  const before = await bottomBrightness();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByLabel('Show text overlay').check();
  await page.getByRole('dialog').getByRole('button', { name: 'Back', exact: true }).click();
  await expect.poll(async () => (await bottomBrightness()) < before - 15, { timeout: 10000 }).toBe(true);
});

test('watermark: text and a picture each change the preview, wherever they are put', async ({ page }) => {
  await page.goto('/');
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 900; canvas.height = 600;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#334455'; c.fillRect(0, 0, 900, 600);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByTestId('quick-edit-input').setInputFiles({ name: 'mark.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await openExportDialog(page);
  await page.getByRole('button', { name: 'Instagram' }).click();
  await page.getByRole('checkbox', { name: /Post · 4:5/ }).check();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  const preview = page.getByRole('img', { name: /as Post · 4:5/ });
  await expect(preview).toBeVisible();
  const mark = page.getByRole('group', { name: 'Watermark' });
  const picture = () => preview.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  const plain = await picture();

  await mark.getByRole('checkbox', { name: 'Add a watermark' }).check();
  await expect(page.getByText('Type some text to see the watermark.')).toBeVisible();
  await mark.getByLabel('Text', { exact: true }).fill('© Kestrel');
  await expect.poll(picture).not.toBe(plain);
  const bottomRight = await picture();
  await mark.getByLabel('Position').selectOption('top-left');
  await expect.poll(picture).not.toBe(bottomRight);

  await mark.getByLabel('Type').selectOption('image');
  await expect(page.getByText('Choose a picture to see the watermark.')).toBeVisible();
  const logo = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 80; canvas.height = 40;
    const c = canvas.getContext('2d')!; c.fillStyle = '#ff7733'; c.fillRect(0, 0, 80, 40);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const withText = await picture();
  await mark.getByLabel('Picture', { exact: true }).setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(logo, 'base64') });
  await expect(page.getByText('Picture chosen.')).toBeVisible();
  await expect.poll(picture).not.toBe(withText);
});

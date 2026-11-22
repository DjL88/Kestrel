import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { openExportDialog } from './helpers';

// The export panel opens in its compact list view by default (#708); the step-by-step wizard is a stored choice.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('kestrel.exportView', 'wizard'); } catch { /* optional preference */ } });
});

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
  const preview = page.getByRole('img', { name: /as Post · 4:5/ }).first();
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((canvas: HTMLCanvasElement) => Number((canvas.width / canvas.height).toFixed(2)))).toBe(0.8);
  const snapshot = await preview.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await page.getByRole('checkbox', { name: 'Show text overlay' }).check();
  await page.getByLabel('Title', { exact: true }).fill('Kite44 at dusk');
  await page.getByLabel('Location', { exact: true }).fill('Herefordshire');
  await page.getByLabel('Alignment').selectOption('centre');
  await expect.poll(() => preview.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).not.toBe(snapshot);
  await page.getByRole('button', { name: /Turn Post · 4:5 on its side/ }).click();
  await expect.poll(() => page.getByRole('img', { name: /as Post · 5:4/ }).first().evaluate((canvas: HTMLCanvasElement) => Number((canvas.width / canvas.height).toFixed(2)))).toBe(1.25);
  await next.click();

  // 4. Review, back and forward keep the choices, then export.
  await expect(page.getByRole('heading', { name: 'Ready to export' })).toBeFocused();
  await expect(page.getByRole('region', { name: 'Ready to export' })).toBeVisible();
  await expect(page.getByText('Post · 5:4').locator('visible=true').first()).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Kite44 at dusk');
  await page.getByRole('dialog').getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Position/ })).toBeFocused();
  await expect(page.getByRole('region', { name: 'Position' })).toBeVisible();
  await next.click();
  await page.getByRole('button', { name: 'Prepare 1 file' }).click();
  await expect(page.getByRole('status').filter({ hasText: '1 file ready' })).toBeVisible({ timeout: 30000 });
});

async function openWizard(page: import('@playwright/test').Page, dimensions = { width: 900, height: 600 }) {
  await page.goto('/');
  const png = await page.evaluate(({ width, height }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#334'; c.fillRect(0, 0, width, height);
    return canvas.toDataURL('image/png').split(',')[1];
  }, dimensions);
  await page.getByTestId('quick-edit-input').setInputFiles({ name: 'w.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await openExportDialog(page);
}

test('full-size export never silently substitutes a smaller file on a constrained device', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', { value: 'iPhone', configurable: true }));
  await openWizard(page, { width: 5000, height: 4000 });
  await page.getByRole('button', { name: 'Full size', exact: true }).click();
  // 'Full size' is the PNG master and goes straight to the review step: no size step, no PNG checkbox.
  await page.getByRole('button', { name: 'Prepare 1 file', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('cannot safely export 5000 × 4000 px');
  await expect(page.getByRole('alert')).toContainText('No smaller file was substituted');
  await expect(page.getByRole('button', { name: 'Download', exact: true })).toHaveCount(0);
  // The failure is recoverable: a deliberately chosen smaller preset still works.
  await page.getByRole('dialog').getByRole('button', { name: /^Remove Full size/ }).click();
  await page.getByRole('button', { name: 'Add another place' }).click();
  await page.getByRole('button', { name: 'Instagram', exact: true }).click();
  await page.getByRole('checkbox', { name: /Post · 4:5/ }).check();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare 1 file', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '1 file ready' })).toBeVisible({ timeout: 30000 });
});

test('a supported full-size PNG download retains the source dimensions', async ({ page }) => {
  await openWizard(page);
  await page.getByRole('button', { name: 'Full size', exact: true }).click();
  // 'Full size' is the PNG master and goes straight to the review step: no size step, no PNG checkbox.
  await page.getByRole('button', { name: 'Prepare 1 file', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '1 file ready' })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const stream = await (await downloaded).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const png = Buffer.concat(chunks);
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([900, 600]);
});

test('desktop export records the edit only after a successful save and can retry the same file', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'uses the desktop save dialog and editor toolbar');
  await page.addInitScript(() => {
    const trace = { picks: 0, writes: 0 };
    Object.assign(window, {
      __saveTrace: trace,
      __TAURI_INTERNALS__: {
        transformCallback: () => 1,
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
        invoke: async (command: string, payload?: { data?: { byteLength?: number; length?: number } }) => {
          if (command === 'plugin:dialog|save') return ++trace.picks === 1 ? null : '/synthetic/export.png';
          // The app streams into a file handle (open, then write); the first write fails, the retry succeeds.
          if (command === 'plugin:fs|open') return 7;
          if (command === 'plugin:fs|write') { if (++trace.writes === 1) throw new Error('Drive unavailable'); return payload?.data?.byteLength ?? payload?.data?.length ?? 0; }
          if (command === 'plugin:opener|reveal_item_in_dir') throw new Error('File manager unavailable');
          return 0;
        },
      },
    });
  });
  let downloads = 0;
  page.on('download', () => { downloads += 1; });
  await openWizard(page);
  await page.getByRole('button', { name: 'Close export' }).click();
  await page.getByRole('button', { name: /Before \/ After/ }).click();
  const lastExport = page.getByLabel('Before comparison stage').locator('option[value="last-export"]');
  await expect(lastExport).toBeDisabled();
  await openExportDialog(page);
  await page.getByRole('button', { name: 'Full size', exact: true }).click();
  // 'Full size' is the PNG master and goes straight to the review step: no size step, no PNG checkbox.
  await page.getByRole('button', { name: 'Prepare 1 file', exact: true }).click();

  const panel = page.getByRole('dialog', { name: 'Export photo' });
  const save = panel.getByRole('button', { name: 'Save', exact: true });
  const trace = () => page.evaluate(() => (window as unknown as { __saveTrace: { picks: number; writes: number } }).__saveTrace);
  await save.click();
  await expect.poll(trace).toEqual({ picks: 1, writes: 0 });
  await expect(save).toBeEnabled();
  await expect(panel.getByRole('status')).toHaveText('1 file ready');
  await expect(lastExport).toBeDisabled();

  await save.click();
  await expect(panel.getByRole('alert')).toContainText('choose another folder');
  await expect(lastExport).toBeDisabled();
  await expect(save).toBeEnabled();

  await save.click();
  // A complete save records the export and closes the dialog; "Saved …" is only shown for a partial batch.
  await expect(panel).toBeHidden();
  await expect.poll(trace).toEqual({ picks: 3, writes: 2 });
  await expect(lastExport).toBeEnabled();
  expect(downloads).toBe(0);
});

test('only the current ZIP is offered when two export batches finish out of order', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kestrel.exportView', 'list');
    const gates: Record<string, () => Promise<void>> = {};
    Object.assign(window, { __zipGates: gates });
    const stream = File.prototype.stream;
    File.prototype.stream = function () {
      if (!/^ig_w_(4x5|1x1)\.jpg$/.test(this.name)) return stream.call(this);
      const file = this;
      return new ReadableStream<Uint8Array<ArrayBuffer>>({
        start(controller) {
          gates[file.name] = async () => {
            controller.enqueue(new Uint8Array(await file.arrayBuffer()));
            controller.close();
          };
        },
      });
    };
  });
  await openWizard(page);
  const panel = page.getByRole('dialog', { name: 'Export photo' });
  const post = panel.getByRole('checkbox', { name: /Post · 4:5/ });
  const square = panel.getByRole('checkbox', { name: /Square · 1:1/ });
  const ready = panel.getByRole('status').filter({ hasText: '2 files ready' });
  const gateNames = () => page.evaluate(() => Object.keys((window as unknown as { __zipGates: object }).__zipGates));
  const release = (name: string) => page.evaluate(async (key) => {
    await (window as unknown as { __zipGates: Record<string, () => Promise<void>> }).__zipGates[key]();
  }, name);

  // The list view shows the size checkboxes directly (no platform heading); Full size JPEG is chosen by default.
  await post.check();
  await panel.getByRole('button', { name: 'Prepare 2 files' }).click();
  await expect(ready).toBeVisible();
  await expect.poll(gateNames).toContain('ig_w_4x5.jpg');
  await panel.getByRole('button', { name: 'Change settings' }).click();
  await post.uncheck();
  await square.check();
  await panel.getByRole('button', { name: 'Prepare 2 files' }).click();
  await expect(ready).toBeVisible();
  await expect.poll(gateNames).toContain('ig_w_1x1.jpg');
  await release('ig_w_4x5.jpg');
  await expect(panel.getByRole('button', { name: 'Packing ZIP…' })).toBeDisabled();
  await release('ig_w_1x1.jpg');

  const download = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download ZIP' }).click();
  const archive = unzipSync(await readFile((await (await download).path())!));
  expect(Object.keys(archive).sort()).toEqual(['ig_w_1x1.jpg', 'w_kestrel.jpg']);
});

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
  const picture = page.getByRole('img', { name: /as Post · 4:5/ }).first();
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
  const preview = page.getByRole('img', { name: /as Post · 4:5/ }).first();
  await expect(preview).toBeVisible();
  const mark = page.getByRole('group', { name: 'Watermark' });
  const picture = () => preview.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  const plain = await picture();

  await mark.getByRole('checkbox', { name: 'Add a watermark' }).check();
  await expect(page.getByText('Type some text to see the watermark.')).toBeVisible();
  await mark.getByLabel('Text', { exact: true }).fill('© Kite44');
  await expect.poll(picture).not.toBe(plain);
  const bottomRight = await picture();
  await mark.getByLabel('Position').selectOption('top-left');
  await expect.poll(picture).not.toBe(bottomRight);

  await mark.getByRole('button', { name: /^Picture/ }).click();
  await expect(page.getByText('Choose a picture to see the watermark.').first()).toBeVisible();
  const logo = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 80; canvas.height = 40;
    const c = canvas.getContext('2d')!; c.fillStyle = '#ff7733'; c.fillRect(0, 0, 80, 40);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const withText = await picture();
  await mark.getByLabel(/^Picture/).setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(logo, 'base64') });
  await expect(page.getByText('Picture chosen.')).toBeVisible();
  await expect.poll(picture).not.toBe(withText);
});

test('watermark settings are remembered the next time Kite44 opens', async ({ page }) => {
  await page.goto('/');
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 200;
    canvas.getContext('2d')!.fillRect(0, 0, 300, 200);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const open = async () => {
    await page.getByTestId('quick-edit-input').setInputFiles({ name: 'keep.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await openExportDialog(page);
    await page.getByRole('button', { name: 'Instagram' }).click();
    await page.getByRole('checkbox', { name: /Post · 4:5/ }).check();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    return page.getByRole('group', { name: 'Watermark' });
  };
  let mark = await open();
  await mark.getByRole('checkbox', { name: 'Add a watermark' }).check();
  await mark.getByLabel('Text', { exact: true }).fill('© Remembered');
  await mark.getByLabel('Position').selectOption('centre');
  await page.reload();
  mark = await open();
  await expect(mark.getByRole('checkbox', { name: 'Add a watermark' })).toBeChecked();
  await expect(mark.getByLabel('Text', { exact: true })).toHaveValue('© Remembered');
  await expect(mark.getByLabel('Position')).toHaveValue('centre');
});

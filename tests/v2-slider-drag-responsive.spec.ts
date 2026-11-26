import { expect, test, type Locator, type Page } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Drags the desktop Adjust and Enhance sliders with a mouse.');
});

type Probe = { longTasks: { start: number; duration: number }[]; frames: string[]; from: number; to: number };
type Win = Window & { __drag: Probe };

/** A large synthetic photo (a soft gradient with mild noise), so every redraw is real per-pixel work. */
async function syntheticPhoto(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const width = 4800, height = 3200;
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#3e5470'); gradient.addColorStop(0.5, '#9aa9b8'); gradient.addColorStop(1, '#6b5a48');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height);
    let seed = 11;
    for (let i = 0; i < data.data.length; i += 4) for (let c = 0; c < 3; c += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data.data[i + c] = Math.max(0, Math.min(255, data.data[i + c] + ((seed >> 8) % 13) - 6));
    }
    ctx.putImageData(data, 0, 0);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/jpeg', 0.9));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  });
  return Buffer.from(base64, 'base64');
}

/** The full picture on screen once the editor is still: a short fingerprint of its pixels and its size. */
async function shownPicture(page: Page): Promise<{ hash: string; width: number; height: number; precision: string | null }> {
  return page.evaluate(async () => {
    const img = document.querySelector<HTMLImageElement>('[data-testid="canvas-frame"] img[data-preview-quality="full"]')!;
    await img.decode().catch(() => undefined);
    const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const digest = await crypto.subtle.digest('SHA-256', ctx.getImageData(0, 0, canvas.width, canvas.height).data);
    return { hash: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join(''), width: canvas.width, height: canvas.height,
      precision: img.getAttribute('data-precision') };
  });
}

/** Wait until the picture is drawn, its image loaded and no redraw is pending. */
async function settled(page: Page) {
  const frame = page.getByTestId('canvas-frame');
  await expect(frame.locator('img[data-preview-quality="full"]').first()).toBeVisible({ timeout: 30_000 });
  await expect(frame.getByRole('status', { name: 'Refreshing image' })).toHaveCount(0, { timeout: 30_000 });
  await expect(frame.getByTestId('live-picture')).toBeHidden({ timeout: 30_000 });
}

/** Wait until the interface thread has been quiet for 3 s, so background work (the import's on-device checks, the previous
 * drag's full-quality redraw) is not counted as the drag's. */
async function quiet(page: Page) {
  const longestGap = () => page.evaluate(() => new Promise<number>(resolve => {
    let last = performance.now(), max = 0;
    const end = last + 3000;
    const tick = () => { const now = performance.now(); max = Math.max(max, now - last); last = now; if (now < end) setTimeout(tick, 16); else resolve(max); };
    setTimeout(tick, 16);
  }));
  await expect.poll(longestGap, { timeout: 120_000, intervals: [0] }).toBeLessThan(50);
}

/** Drag a range input's thumb across most of its track with the mouse, in small steps, as a person would. */
async function drag(page: Page, slider: Locator, fromFraction: number, toFraction: number) {
  await slider.scrollIntoViewIfNeeded();
  const box = (await slider.boundingBox())!;
  const y = box.y + box.height / 2;
  const at = (fraction: number) => box.x + 8 + (box.width - 16) * fraction;
  await page.mouse.move(at(fromFraction), y);
  await page.evaluate(() => {
    const probe: Probe = { longTasks: [], frames: [], from: performance.now(), to: 0 };
    (window as unknown as Win).__drag = probe;
    new PerformanceObserver(list => { for (const entry of list.getEntries()) probe.longTasks.push({ start: entry.startTime, duration: entry.duration }); })
      .observe({ type: 'longtask', buffered: false });
    // Which scripts held a slow frame, so a failure names its cause.
    try {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries() as unknown as { startTime: number; duration: number; scripts?: { invoker: string; sourceFunctionName: string; sourceURL: string; duration: number }[] }[]) {
          if (entry.duration < 50 || entry.startTime < probe.from || (probe.to && entry.startTime > probe.to)) continue;
          probe.frames.push(`at +${Math.round(entry.startTime - probe.from)} ms, ${Math.round(entry.duration)} ms (render ${Math.round((entry as unknown as { renderStart: number }).renderStart - entry.startTime)}, style+layout ${Math.round((entry as unknown as { styleAndLayoutStart: number; renderStart: number }).styleAndLayoutStart ? entry.duration - ((entry as unknown as { styleAndLayoutStart: number }).styleAndLayoutStart - entry.startTime) : 0)}): ${(entry.scripts ?? []).filter(script => script.duration > 5).map(script => `${script.invoker} ${script.sourceFunctionName || '?'} (${script.sourceURL.split('/').pop()}) ${Math.round(script.duration)} ms`).join('; ')}`);
        }
      }).observe({ type: 'long-animation-frame', buffered: false });
    } catch { /* an engine without frame timing */ }
  });
  await page.mouse.down();
  const steps = 24, started = Date.now();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(at(fromFraction + (toFraction - fromFraction) * (i / steps)), y);
    await page.waitForTimeout(40);
  }
  console.log(`drag of ${steps} steps took ${Date.now() - started} ms`);
  // The pointer is still held: everything up to here is "during the drag".
  const during = await page.evaluate(() => {
    const probe = (window as unknown as Win).__drag;
    probe.to = performance.now();
    return probe.longTasks.filter(task => task.start >= probe.from && task.start <= probe.to).map(task => Math.round(task.duration));
  });
  const frames = await page.evaluate(() => (window as unknown as Win).__drag.frames);
  if (frames.length) console.log(`slow frames while dragging:\n    ${frames.join('\n    ')}`);
  await page.mouse.up();
  return during;
}

/**
 * Dragging a slider keeps the interface thread free: the picture follows the thumb from a quick redraw at screen size, and
 * the full-quality picture is drawn once the thumb is let go. That final picture is exactly the one the editor draws for the
 * same settings without a drag (a keyboard step away and back, the editor's ordinary redraw), so dragging never changes
 * quality.
 */
test('?v2 dragging Exposure, Dehaze and Noise reduction keeps the interface free, and the final picture is unchanged', async ({ page }) => {
  test.setTimeout(300_000);
  // On-device models are refused here, so the import's background checks (species, subject finder) end at once instead of
  // loading a model in the middle of a drag: this test measures the slider and the picture, not those checks.
  await page.route(/\.(onnx|ort)(\?|$)/, route => route.abort());
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Slider drag');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const photo = await syntheticPhoto(page);
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'drag-large.jpg', mimeType: 'image/jpeg', buffer: photo }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  await settled(page);

  const advanced = root.getByRole('tab', { name: 'Advanced Edits' });
  if (!await advanced.isVisible()) await root.getByRole('button', { name: 'Adjust' }).first().click();
  await advanced.click();
  await quiet(page);

  const report: string[] = [];
  const longTasks: Record<string, number[]> = {};
  longTasks.exposure = await drag(page, root.getByRole('slider', { name: 'Exposure' }), 0.5, 0.75);
  await settled(page);
  await quiet(page);
  longTasks.dehaze = await drag(page, root.locator('#slider-dehaze'), 0.5, 0.8);
  await settled(page);
  await root.getByRole('button', { name: 'Enhance', exact: true }).first().click();
  await quiet(page);
  longTasks.noise = await drag(page, root.getByTestId('v2-enhance-luminance'), 0.05, 0.6);
  await settled(page);
  await quiet(page);
  const afterDrag = await shownPicture(page);

  const marks = await page.evaluate(() => performance.getEntriesByType('measure').filter(entry => entry.name.startsWith('inflight:'))
    .reduce<Record<string, number[]>>((all, entry) => { (all[entry.name] ??= []).push(Math.round(entry.duration)); return all; }, {}));
  for (const [name, values] of Object.entries(marks)) report.push(`${name}: n=${values.length} max=${Math.max(...values)} ms`);
  for (const [name, values] of Object.entries(longTasks)) report.push(`long tasks while dragging ${name}: [${values.join(', ')}] ms`);
  console.log(`slider drag:\n  ${report.join('\n  ')}`);
  test.info().annotations.push({ type: 'slider drag', description: report.join('; ') });

  // Today's render of the same settings, without any drag: one keyboard step away and one back (no pointer, so the
  // ordinary redraw), which leaves the edit exactly as the drag left it.
  const noise = root.getByTestId('v2-enhance-luminance');
  const dragged = await noise.inputValue();
  await noise.focus();
  await page.keyboard.press('ArrowRight');
  await settled(page);
  await page.keyboard.press('ArrowLeft');
  await expect(noise).toHaveValue(dragged);
  await settled(page);
  await quiet(page);
  const reopened = await shownPicture(page);

  for (const [name, values] of Object.entries(longTasks)) {
    expect.soft(values.filter(duration => duration > 50), `long tasks over 50 ms while dragging ${name}`).toEqual([]);
  }
  expect(afterDrag.width).toBe(reopened.width);
  expect(afterDrag.height).toBe(reopened.height);
  expect(afterDrag.hash, 'the picture after the drag is pixel-identical to the same edit drawn without a drag').toBe(reopened.hash);
});

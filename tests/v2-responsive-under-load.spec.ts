import { expect, test, type Page } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Drives the desktop editor with a mouse.');
});

type Probe = { events: { name: string; delay: number; duration: number; at: number }[]; longTasks: { at: number; duration: number }[]; frames: string[] };
type Win = Window & { __probe: Probe; __burners: Worker[] };

/**
 * Served as the desktop app serves it (src-tauri/tauri.conf.json), so model threads and shared memory behave the same.
 * On the whole context, so the workers' own scripts get the headers too (a cross-origin isolated page refuses a worker
 * whose script lacks them, and the models would then run on the page, which the app never does).
 */
async function desktopHeaders(page: Page) {
  await page.context().route('**/*', async (route) => {
    const response = await route.fetch().catch(() => null);
    if (!response) { await route.continue(); return; }
    await route.fulfill({ response, headers: { ...response.headers(), 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' } });
  });
}

/**
 * Every core but one busy at full speed, as other programs would keep them: the page must still answer at once.
 *
 * Scaled to the machine: where the browser has no graphics card and draws in software (SwiftShader or llvmpipe, as on
 * the CI runners), its drawing runs on the processor too, which on a desktop the graphics card does. Two cores are left
 * then, one for the page and one for that software drawing, or the test would measure the runner's missing graphics card
 * rather than InFlight. The limits below stay the same either way.
 */
async function saturate(page: Page) {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    const renderer = String((gl && info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER)) ?? '');
    const softwareDrawing = !gl || /swiftshader|llvmpipe|software/i.test(renderer);
    const cores = Math.max(1, (navigator.hardwareConcurrency || 4) - (softwareDrawing ? 2 : 1));
    const code = 'let x = 0; for (;;) { x = (x * 1103515245 + 12345) | 0; }';
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    (window as unknown as Win).__burners = Array.from({ length: cores }, () => new Worker(url));
    return `${cores} of ${navigator.hardwareConcurrency}${softwareDrawing ? `, drawing in software (${renderer || 'no WebGL'})` : ''}`;
  });
}

async function startProbe(page: Page) {
  await page.evaluate(() => {
    const probe: Probe = { events: [], longTasks: [], frames: [] };
    (window as unknown as Win).__probe = probe;
    // How long each click, key or pointer move waited before the page handled it, and how long until it was drawn.
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceEventTiming[]) {
        if (!/^(pointerdown|pointerup|click|keydown|input|pointermove)$/.test(entry.name)) continue;
        probe.events.push({ name: entry.name, delay: entry.processingStart - entry.startTime, duration: entry.duration, at: entry.startTime });
      }
    }).observe({ type: 'event', buffered: false, durationThreshold: 16 } as PerformanceObserverInit);
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) probe.longTasks.push({ at: entry.startTime, duration: entry.duration }); })
      .observe({ type: 'longtask', buffered: false });
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as { duration: number; scripts?: { invoker: string; sourceFunctionName: string; sourceURL: string; duration: number }[] }[]) {
          if (entry.duration < 50) continue;
          probe.frames.push(`${Math.round(entry.duration)} ms: ${(entry.scripts ?? []).filter((s) => s.duration > 5)
            .map((s) => `${s.invoker} ${s.sourceFunctionName || '?'} (${s.sourceURL.split('/').pop()}) ${Math.round(s.duration)} ms`).join('; ')}`);
        }
      }).observe({ type: 'long-animation-frame', buffered: false });
    } catch { /* an engine without frame timing */ }
  });
}

/** A few synthetic photos, so imports, thumbnails and the background checks run while the person works. */
async function photos(page: Page, count: number) {
  const list = await page.evaluate(async (n) => {
    const out: string[] = [];
    for (let k = 0; k < n; k += 1) {
      const canvas = document.createElement('canvas'); canvas.width = 2400; canvas.height = 1600;
      const ctx = canvas.getContext('2d')!;
      const gradient = ctx.createLinearGradient(0, 0, 2400, 1600);
      gradient.addColorStop(0, `hsl(${(k * 37) % 360} 40% 35%)`); gradient.addColorStop(1, `hsl(${(k * 37 + 120) % 360} 30% 70%)`);
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, 2400, 1600);
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.ellipse(1200 + k * 20, 800, 300, 200, 0, 0, Math.PI * 2); ctx.fill();
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.88));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      out.push(btoa(binary));
    }
    return out;
  }, count);
  return list.map((data, i) => ({ name: `load-${String(i + 1).padStart(2, '0')}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(data, 'base64') }));
}

/**
 * The interface answers at once whatever the machine is doing (owner, 27 Nov: "we need to avoid being hijacked by
 * processing power"). With every core but one kept busy by other work and InFlight's own import running, the common
 * actions (choose a photo, open panels, drag a slider, zoom) are each answered within 100 ms.
 *
 * The input limit (100 ms) holds everywhere, CI included.
 *
 * The goal is also that no task holds the page for more than 50 ms. That is not met yet, so this checks a ratchet that
 * may only be tightened, measured on 27 Nov:
 * - Windows laptop (15 of 16 cores busy, real graphics card): a few canvas and filmstrip redraws of 70 to 140 ms. Ratchet:
 *   none over 150 ms, at most 8 over 50 ms. Before this test's fixes: 22 tasks, up to 690 ms.
 * - CI runner (2 of 4 cores busy, drawing in software): 17 to 21 tasks, up to 680 ms. Ratchet: none over 750 ms, at most
 *   24 over 50 ms. What is left there is page work in other parts, named so it can be moved: the subject detector's work
 *   around its model (up to 680 ms), Auto's measuring and planning on the analysis picture (about 500 ms together), a
 *   timer with no script named (about 390 ms), and the filmstrip and canvas redraws (tighten when #1833 lands).
 */
// Tagged @stress: CI runs it on its own (.github/workflows/ci.yml), as it keeps the processor busy on purpose.
test('?v2 with the processor saturated and an import running, the editor answers every action at once @stress', async ({ page }) => {
  test.setTimeout(300_000);
  await desktopHeaders(page);
  // The models must run in their workers, as in the app: a fallback to the page would measure a different program.
  const fellBack: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (/running (on the main thread|it here instead)/i.test(text)) fellBack.push(text.slice(0, 200));
  });
  await page.goto('/?v2');
  expect(await page.evaluate(() => crossOriginIsolated), 'served as the desktop app serves it').toBe(true);
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Under load');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const files = await photos(page, 12);
  const cores = await saturate(page);

  await startProbe(page);
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles(files);
  const options = root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option');
  await expect(options).toHaveCount(12, { timeout: 120_000 });

  // Choose photos while their thumbnails and checks are still being made.
  for (const i of [1, 4, 7, 2]) {
    await options.nth(i).getByRole('button').nth(1).click();
    await expect(options.nth(i)).toHaveAttribute('aria-selected', 'true');
  }
  // Open panels.
  for (const name of ['Enhance', 'Masks', 'Adjust']) await root.getByRole('button', { name, exact: true }).first().click();
  const advanced = root.getByRole('tab', { name: 'Advanced Edits' });
  if (await advanced.isVisible()) await advanced.click();
  // Drag a slider.
  const exposure = root.getByRole('slider', { name: 'Exposure' });
  await exposure.scrollIntoViewIfNeeded();
  const box = (await exposure.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 16; i += 1) { await page.mouse.move(box.x + box.width * (0.5 + 0.02 * i), box.y + box.height / 2); await page.waitForTimeout(30); }
  await page.mouse.up();
  // Zoom in and out.
  await root.getByRole('button', { name: 'Zoom in' }).click();
  await root.getByRole('button', { name: 'Zoom in' }).click();
  await root.getByRole('button', { name: 'Zoom out' }).click();
  await page.waitForTimeout(1500);

  const probe = await page.evaluate(() => {
    const p = (window as unknown as Win).__probe;
    (window as unknown as Win).__burners.forEach((w) => w.terminate());
    return p;
  });
  const delays = probe.events.map((e) => e.delay).sort((a, b) => a - b);
  const worst = probe.events.filter((e) => e.delay > 100).map((e) => `${e.name} waited ${Math.round(e.delay)} ms`);
  const long = probe.longTasks.filter((t) => t.duration > 50).map((t) => Math.round(t.duration));
  console.log(`under load (busy cores: ${cores}): ${probe.events.length} slow-ish events, input delay median ${Math.round(delays[delays.length >> 1] ?? 0)} ms, worst ${Math.round(delays.at(-1) ?? 0)} ms; long tasks over 50 ms: [${long.join(', ')}]`);
  const marks = await page.evaluate(() => performance.getEntriesByType('measure').filter((m) => m.name.startsWith('inflight:') && m.duration > 50)
    .map((m) => `${m.name} ${Math.round(m.duration)} ms`));
  if (marks.length) console.log(`InFlight steps over 50 ms (time taken, not all of it on the page): ${marks.join(', ')}`);
  if (probe.frames.length) console.log(`slow frames:\n  ${probe.frames.slice(0, 25).join('\n  ')}`);
  if (fellBack.length) console.log(`models that fell back to the page:\n  ${fellBack.join('\n  ')}`);
  expect.soft(fellBack, 'every model ran in its worker, as in the app').toEqual([]);
  // The ratchet in the comment above: the laptop's, or the CI runner's.
  const ratchet = process.env.CI ? { longest: 750, count: 24 } : { longest: 150, count: 8 };
  expect.soft(probe.events.filter((e) => e.delay > 100).map((e) => `${e.name} waited ${Math.round(e.delay)} ms`), 'every action is answered within 100 ms').toEqual([]);
  expect.soft(long.filter((d) => d > ratchet.longest), `no task holds the page for more than ${ratchet.longest} ms (ratchet; the goal is 50)`).toEqual([]);
  expect.soft(long.length, `at most ${ratchet.count} tasks over 50 ms (ratchet; the goal is none)`).toBeLessThanOrEqual(ratchet.count);
  if (worst.length) console.log(`slow answers: ${worst.join(', ')}`);
});

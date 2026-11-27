import { expect, test } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'the V2 phone layout is checked in a later slice');
});

/**
 * Denoise renders and checks several full working-size candidates. That work runs in a Web Worker
 * (src/providers/denoiseOffThread.ts), so the editor must keep answering clicks while it runs.
 */
test('?v2 the editor stays responsive while denoise runs, and the work runs in a worker', async ({ page }) => {
  // The first subject detection loads its on-device models, which alone can take over a minute on a busy laptop.
  test.setTimeout(300_000);
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Denoise responsiveness');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  // A large, plainly noisy synthetic photo, so every candidate render is real work at the full 1600 px working size.
  const image = await page.evaluate(async () => {
    const width = 2400, height = 1600;
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, '#46586e'); gradient.addColorStop(1, '#8a9bb0');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height);
    let seed = 9;
    for (let i = 0; i < data.data.length; i += 4) for (let c = 0; c < 3; c += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data.data[i + c] = Math.max(0, Math.min(255, data.data[i + c] + ((seed >> 8) % 41) - 20));
    }
    ctx.putImageData(data, 0, 0);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/png'));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'noisy-large.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  await expect(root.getByTestId('canvas-frame').locator('canvas, img').first()).toBeVisible({ timeout: 30000 });
  await root.getByRole('button', { name: 'Enhance', exact: true }).first().click();
  const compare = root.getByRole('button', { name: 'Compare', exact: true });
  await expect(compare).toBeVisible();

  // Importing starts other background work (auto modes, the similarity model's check) that is not denoise. Wait until the
  // interface thread has been quiet for 3 s, so what is measured below is denoise alone.
  const quietWindow = () => page.evaluate(() => new Promise<number>(resolve => {
    let last = performance.now(), max = 0;
    const end = last + 3000;
    const tick = () => {
      const now = performance.now();
      max = Math.max(max, now - last); last = now;
      if (now < end) setTimeout(tick, 16); else resolve(max);
    };
    setTimeout(tick, 16);
  }));
  await expect.poll(quietWindow, { timeout: 150_000, intervals: [0] }).toBeLessThan(100);

  const workers: string[] = [];
  page.on('worker', worker => workers.push(worker.url()));
  // Watch the interface thread: the longest gap between 16 ms ticks, and how long a click waits before it is handled.
  await page.evaluate(() => {
    const probe = { maxGap: 0, inputDelays: [] as number[], running: true, longTasks: [] as string[], blocked: 0, started: performance.now(), ended: 0 };
    new PerformanceObserver(list => { for (const e of list.getEntries()) { probe.blocked += e.duration; probe.longTasks.push(`${Math.round(e.startTime - probe.started)}+${Math.round(e.duration)}`); } }).observe({ type: 'longtask', buffered: false });
    (window as unknown as { __probe: typeof probe }).__probe = probe;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      probe.maxGap = Math.max(probe.maxGap, now - last);
      last = now;
      if (probe.running) setTimeout(tick, 16);
    };
    setTimeout(tick, 16);
    document.addEventListener('click', event => { probe.inputDelays.push(performance.now() - event.timeStamp); }, { capture: true });
  });

  const started = Date.now();
  await root.getByRole('button', { name: 'Run TrueDetail on this photo' }).click();
  // While it runs, the button that started it says so (owner, 26 Nov), not only the Tasks list.
  await expect(root.getByTestId('truedetail-run')).toHaveAttribute('aria-busy', 'true', { timeout: 10_000 });
  const done = root.getByText(/Denoised on this device|Left as it was/).first();
  // While denoise is running, a button still reacts.
  let clicks = 0;
  while (!(await done.isVisible()) && Date.now() - started < 200_000) {
    const before = await compare.getAttribute('aria-pressed');
    await compare.click();
    await expect(compare).not.toHaveAttribute('aria-pressed', before ?? '', { timeout: 1000 });
    clicks += 1;
    await page.waitForTimeout(150);
  }
  await expect(done).toBeVisible({ timeout: 30_000 });
  const elapsed = Date.now() - started;
  const probe = await page.evaluate(() => {
    const p = (window as unknown as { __probe: { maxGap: number; inputDelays: number[]; running: boolean; longTasks: string[]; blocked: number; started: number; ended: number } }).__probe;
    p.running = false;
    p.ended = performance.now();
    return p;
  });
  const blockedShare = probe.blocked / (probe.ended - probe.started);
  test.info().annotations.push({ type: 'denoise', description: `ran ${elapsed} ms; interface blocked ${Math.round(blockedShare * 100)}% of the time; longest interface gap ${Math.round(probe.maxGap)} ms; click delays ${probe.inputDelays.map(Math.round).join(', ')} ms; long tasks (start+ms) ${probe.longTasks.join(', ')}` });

  expect(clicks, 'denoise was still running when the button was pressed').toBeGreaterThan(0);
  // The typical click, not the single slowest: on a shared CI runner another test's browser can stall one click past
  // 200 ms (seen: 296 ms) even with the worker doing the pixels. Without the worker most clicks wait seconds.
  const delays = [...probe.inputDelays].sort((a, b) => a - b);
  expect(delays[Math.floor(delays.length / 2)], 'a typical click is handled within 200 ms while denoise runs').toBeLessThan(200);
  // Without the worker one task holds the interface for most of the run (measured: 14.5 s of 18 s). Other background work
  // (result handling in the subject detector, rendering on a busy machine) can still cause an occasional long frame, so
  // the check is on the share of time blocked, not on the single longest gap, which is recorded above.
  expect(blockedShare, 'the interface thread is free for most of the denoise run').toBeLessThan(0.25);
  expect(workers.some(url => /denoiseWorker/.test(url)), `denoise worker started (saw: ${workers.join(', ')})`).toBe(true);
  await expect(root.getByText(/could not denoise in the background/)).toHaveCount(0);
});

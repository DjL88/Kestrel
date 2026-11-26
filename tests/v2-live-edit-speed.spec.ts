import { expect, test } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Uses the desktop Adjust panel.');
});

/**
 * A slider step's picture is drawn straight onto the live canvas over the shown one, and the PNG that replaces it
 * follows. This records, for the same steps, when each appeared: the live canvas (what the person now sees) and the
 * PNG image (what they saw before), and checks the canvas gives way to the image once it has loaded.
 */
test('?v2 an edit step shows on the live canvas before its PNG, then the PNG replaces it', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Live edit speed');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const image = await page.evaluate(async () => {
    const width = 2400, height = 1600;
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const data = ctx.createImageData(width, height);
    let seed = 5;
    for (let i = 0; i < data.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const n = ((seed >> 8) % 41) - 20, x = (i / 4) % width;
      data.data[i] = 70 + (x % 120) + n; data.data[i + 1] = 100 + n; data.data[i + 2] = 150 - (x % 80) + n; data.data[i + 3] = 255;
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
  await (await chooser).setFiles([{ name: 'live-edit.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  const frame = root.getByTestId('canvas-frame');
  await expect(frame.locator('img[data-preview-quality="full"]').first()).toBeVisible({ timeout: 30_000 });

  // Adjust opens by default; pressing it again would close it.
  const advanced = root.getByRole('tab', { name: 'Advanced Edits' });
  if (!await advanced.isVisible()) await root.getByRole('button', { name: 'Adjust' }).first().click();
  await advanced.click();
  const exposure = root.getByRole('slider', { name: 'Exposure' });

  // Watch the frame: when the live canvas becomes visible, and when a new full image finishes loading.
  await page.evaluate(() => {
    const host = document.querySelector('[data-testid="canvas-frame"]')!;
    const marks = { live: [] as number[], png: [] as number[] };
    (window as unknown as { __marks: typeof marks }).__marks = marks;
    const watch = (img: HTMLImageElement) => img.addEventListener('load', () => { if (img.dataset.previewQuality === 'full') marks.png.push(performance.now()); });
    new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'attributes' && (record.target as HTMLElement).dataset.testid === 'live-picture'
          && (record.target as HTMLElement).style.display !== 'none') marks.live.push(performance.now());
        for (const node of Array.from(record.addedNodes)) if (node instanceof HTMLImageElement) watch(node);
      }
    }).observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
  });

  const live: number[] = [], png: number[] = [];
  for (const value of ['0.3', '0.6', '0.9', '0.4', '0.1', '0.7']) {
    const before = await page.evaluate(() => { const m = (window as unknown as { __marks: { live: number[]; png: number[] } }).__marks; return { live: m.live.length, png: m.png.length, at: performance.now() }; });
    await exposure.fill(value);
    await expect.poll(() => page.evaluate(n => (window as unknown as { __marks: { png: number[] } }).__marks.png.length > n, before.png), { timeout: 20_000 }).toBe(true);
    const marks = await page.evaluate(() => (window as unknown as { __marks: { live: number[]; png: number[] } }).__marks);
    const liveAt = marks.live[before.live], pngAt = marks.png[before.png];
    expect(liveAt, `the step to ${value} was drawn on the live canvas`).toBeDefined();
    live.push(liveAt - before.at); png.push(pngAt - before.at);
    expect(liveAt).toBeLessThanOrEqual(pngAt);
    // Once the image has loaded, the live canvas gives way to it.
    await expect(frame.getByTestId('live-picture')).toBeHidden();
  }
  const median = (values: number[]) => Math.round([...values].sort((a, b) => a - b)[values.length >> 1]);
  test.info().annotations.push({ type: 'live edit', description: `step to picture (median of ${live.length}): live canvas ${median(live)} ms, PNG image ${median(png)} ms` });
  console.log(`live edit: live canvas ${median(live)} ms, PNG image ${median(png)} ms (${live.map(Math.round)} / ${png.map(Math.round)})`);
});

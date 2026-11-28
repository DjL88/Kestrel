import { expect, test } from '@playwright/test';

// skipped: asserts the red U2-Netp outline model, default off for beta; re-enable against the own mask model (audit item ML-3).
test.skip('local segmentation keeps a fine outline when box detection is unavailable', async ({ page, context }) => {
  await page.route('**/*yolox_tiny.onnx*', route =>
    route.request().resourceType() === 'fetch' ? route.abort() : route.continue());
  const photoUploads: string[] = [];
  page.on('request', request => {
    if (request.postDataBuffer()?.length) photoUploads.push(request.url());
  });
  await page.goto('/?v2');
  const result = await page.evaluate(async () => {
    const url = '/src/providers/subjectDetector.ts';
    const { detectSubjectGuided } = await import(/* @vite-ignore */ url);
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 320;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#2a3340';
    ctx.fillRect(0, 0, 480, 320);
    const gradient = ctx.createRadialGradient(240, 160, 10, 240, 160, 90);
    gradient.addColorStop(0, '#f2d9a0');
    gradient.addColorStop(1, '#b8863c');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(240, 160, 90, 70, 0, 0, Math.PI * 2);
    ctx.fill();
    const run = () => detectSubjectGuided(canvas);
    Object.assign(window, { runOfflineMaskCheck: run });
    return run();
  });
  expect(result.assessment.usable).toBe(true);
  expect(result.guide).toBeNull();
  expect(result.grid.w).toBe(192);
  expect(result.detail?.region).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  expect(result.detail?.grid.w).toBe(384);
  const grid = result.detail!.grid;
  const alpha = Buffer.from(grid.data, 'base64');
  expect(alpha[Math.floor(grid.h / 2) * grid.w + Math.floor(grid.w / 2)]).toBeGreaterThan(200);
  expect(alpha[0]).toBeLessThan(20);

  await context.setOffline(true);
  const offline = await page.evaluate(() => (window as unknown as {
    runOfflineMaskCheck: () => Promise<typeof result>;
  }).runOfflineMaskCheck());
  expect(offline.detail).toEqual(result.detail);
  expect(photoUploads).toEqual([]);
});

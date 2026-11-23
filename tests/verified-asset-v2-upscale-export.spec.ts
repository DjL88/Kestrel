import { expect, test } from '@playwright/test';

/** Run against the Vite DEV server: npm run test:e2e:dev -- --grep "upscale export". Synthetic fixture only. */
test('upscale export: 2x lifts the size cap and enlarges the real exported pixels; off stays capped', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    // @ts-ignore Browser module resolved by Vite dev server.
    const { renderV2Export } = await import('/src/v2/engineClient/renderV2Export.ts');
    // @ts-ignore Browser module resolved by Vite dev server.
    const { DEFAULT_CROP } = await import('/src/v2/engineClient/cropOps.ts');
    const source = document.createElement('canvas'); source.width = 400; source.height = 200;
    const sctx = source.getContext('2d')!;
    const gradient = sctx.createLinearGradient(0, 0, 400, 0); gradient.addColorStop(0, '#102030'); gradient.addColorStop(1, '#f0c040');
    sctx.fillStyle = gradient; sctx.fillRect(0, 0, 400, 200);
    sctx.fillStyle = '#ff004e'; sctx.fillRect(150, 60, 100, 80);
    const image = new Image(); image.src = source.toDataURL('image/png'); await image.decode();
    const profile = { id: 'uat', label: 'UAT PNG', prefix: 'u_', width: 0, height: 0, quality: 1, format: 'png' as const };
    const date = new Date('2026-11-23T12:00:00.000Z');
    const frame = (upscale?: 2 | 4) => ({ id: 'f', filename: 'up.png', isDemo: true, edit: { exposure: 0, warmth: 0, colour: 0, ...(upscale ? { upscale } : {}) } });
    const dims = async (file: File) => { const b = await createImageBitmap(file); const d = { w: b.width, h: b.height }; b.close(); return d; };
    const off = await renderV2Export(image, frame(), { width: 800, height: 400 }, { ...DEFAULT_CROP }, profile, null, date);
    const two = await renderV2Export(image, frame(2), { width: 800, height: 400 }, { ...DEFAULT_CROP }, profile, null, date);
    const small = await renderV2Export(image, frame(2), { width: 200, height: 100 }, { ...DEFAULT_CROP }, profile, null, date);
    return { off: { ...(await dims(off.file)), capped: off.capped }, two: { ...(await dims(two.file)), capped: two.capped }, small: await dims(small.file) };
  });
  expect(result.off).toEqual({ w: 400, h: 200, capped: true });
  expect(result.two).toEqual({ w: 800, h: 400, capped: false });
  expect(result.small).toEqual({ w: 200, h: 100 });
});

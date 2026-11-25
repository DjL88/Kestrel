import { expect, test } from '@playwright/test';

/**
 * Format exports of a 16-bit picture stay 16-bit through crop, border, overlays and split (Finish Line x-raw-formats16).
 * Run against the Vite DEV server: npm run test:e2e:dev -- --grep "16-bit format export"
 *
 * The picture is a synthetic RGB16 ramp whose values are not whole 8-bit levels, so any 8-bit step on the way shows up
 * as every value becoming a multiple of 257. Each PNG is read back from the exported bytes, value by value; nothing is
 * taken from the renderer's own word. No customer photo, no network.
 */
const cases = [
  { name: 'cover crop', crop: {}, sections: 1, overlay: false },
  { name: 'zoom, pan, flips and a quarter turn', crop: { zoom: 1.25, panX: 6, panY: -4, flipH: true, flipV: true, rotateDeg: 90 }, sections: 1, overlay: false },
  { name: 'border and edge insets', crop: { borderWidth: 5, borderColour: '#c03020', insetLeft: 4, insetTop: 3 }, sections: 1, overlay: false },
  { name: 'text and watermark overlay', crop: {}, sections: 1, overlay: true },
  { name: 'two-frame split with a border', crop: { borderWidth: 4, borderColour: '#ffffff' }, sections: 2, overlay: false },
] as const;

for (const variant of cases) {
  test('16-bit format export stays 16-bit to the file: ' + variant.name, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Pure rendering; one project is enough.');
    await page.goto('/');
    const report = await page.evaluate(async (settings) => {
      // @ts-ignore Browser module resolved by Vite dev server.
      const { renderV2Export } = await import('/src/v2/engineClient/renderV2Export.ts');
      // @ts-ignore Browser module resolved by Vite dev server.
      const { DEFAULT_CROP } = await import('/src/v2/engineClient/cropOps.ts');
      // @ts-ignore Browser module resolved by Vite dev server.
      const { readPng16 } = await import('/src/core/png16.ts');
      // @ts-ignore Browser module resolved by Vite dev server.
      const { looksEightBit } = await import('/src/core/compose16.ts');
      // @ts-ignore Browser module resolved by Vite dev server.
      const { ditherRgb16ToRgba8 } = await import('/src/core/rgb16Output.ts');
      // @ts-ignore Browser module resolved by Vite dev server.
      const { createDefaultOverlay } = await import('/src/v2/ui/stub.ts');

      // A 16-bit picture with smooth ramps and a bright block, none of it on whole 8-bit levels.
      const width = 480, height = 320;
      const data = new Uint16Array(width * height * 3);
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        const at = (y * width + x) * 3;
        const block = x > 200 && x < 280 && y > 100 && y < 220;
        data[at] = block ? 60001 : 2001 + x * 97 + (y % 3);
        data[at + 1] = block ? 12003 : 9001 + y * 131;
        data[at + 2] = block ? 30011 : 50003 - x * 41 - y * 7;
      }
      const precise = { width, height, data };

      // The 8-bit picture the canvas path would use: the same pixels, rounded once.
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d')!.putImageData(new ImageData(ditherRgb16ToRgba8(precise), width, height), 0, 0);
      const image = new Image();
      image.src = canvas.toDataURL('image/png');
      await image.decode();

      const frame = { id: 'f16', filename: 'format16.png', isDemo: true, edit: { exposure: 0, warmth: 0, colour: 0 } } as Parameters<typeof renderV2Export>[1];
      const png = { id: 'p16', label: 'PNG', prefix: 'p_', width: 0, height: 0, quality: 1, format: 'png' as const };
      const jpeg = { ...png, id: 'j8', format: 'jpeg' as const, quality: 0.95 };
      const crop = { ...DEFAULT_CROP, ...settings.crop };
      const date = new Date('2026-11-25T23:00:00.000Z');
      const overlay = settings.overlay ? {
        overlay: { ...createDefaultOverlay(true), watermarkEnabled: true, watermarkPosition: 'top-right' },
        text: true, watermark: true,
        rows: [{ text: 'Nikon Z 8 · 16-bit', family: 'sans-serif', weight: 600, sizePx: 14, letterSpacing: 0 }],
        mark: { kind: 'text', text: 'INFLIGHT' }, contrast: 'light-on-dark',
      } : null;
      const size = { width: 300 / settings.sections, height: 240 };

      const result = await renderV2Export(image, frame, size, crop, png, overlay, date, undefined, settings.sections, precise);
      const files: File[] = result.sections ?? [result.file];
      const pictures = await Promise.all(files.map(async (file) => readPng16(new Uint8Array(await file.arrayBuffer()))));

      // The same export through the 8-bit canvas path (no 16-bit picture), to check the framing is the same.
      const canvasResult = await renderV2Export(image, frame, size, crop, png, overlay, date, undefined, settings.sections);
      const canvasFiles: File[] = canvasResult.sections ?? [canvasResult.file];
      let sum = 0, count = 0, large = 0;
      for (let i = 0; i < canvasFiles.length; i += 1) {
        const bitmap = await createImageBitmap(canvasFiles[i]);
        const c = document.createElement('canvas');
        c.width = bitmap.width; c.height = bitmap.height;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(bitmap, 0, 0);
        const eight = ctx.getImageData(0, 0, c.width, c.height).data;
        const sixteen = pictures[i].data;
        for (let p = 0; p < c.width * c.height; p += 1) for (let ch = 0; ch < 3; ch += 1) {
          const diff = Math.abs(sixteen[p * 3 + ch] / 257 - eight[p * 4 + ch]);
          sum += diff; count += 1; if (diff > 24) large += 1;
        }
      }

      // The border colour, exactly, at the top-left corner when there is a border.
      const corner = Array.from(pictures[0].data.subarray(0, 3));
      // The same render as JPEG: rounded once at the end, the same size.
      const asJpeg = await renderV2Export(image, frame, size, crop, jpeg, overlay, date, undefined, settings.sections, precise);
      const jpegBitmap = await createImageBitmap(asJpeg.file);
      const jpegSize = [jpegBitmap.width, jpegBitmap.height];
      jpegBitmap.close();
      return {
        precision: result.precision, bits: result.bitsPerChannel, jpegPrecision: asJpeg.precision, jpegBits: asJpeg.bitsPerChannel, jpegSize,
        sizes: pictures.map((p: { width: number; height: number }) => [p.width, p.height]),
        eightBit: pictures.map((p: Parameters<typeof looksEightBit>[0]) => looksEightBit(p)),
        types: files.map((f) => f.type), names: files.map((f) => f.name),
        meanDiff: sum / count, largeShare: large / count, corner,
      };
    }, { crop: variant.crop, sections: variant.sections, overlay: variant.overlay });

    expect(report.precision).toBe('rgb16');
    expect(report.bits).toBe(16);
    expect(report.types.every((type) => type === 'image/png')).toBe(true);
    expect(report.sizes).toEqual(Array.from({ length: variant.sections }, () => [300 / variant.sections, 240]));
    // Read back from the files: real 16-bit values, not 8-bit levels padded out.
    expect(report.eightBit).toEqual(Array.from({ length: variant.sections }, () => false));
    // Same framing as the canvas path: on average within a level or two, and almost no pixel far off (edges only).
    expect(report.meanDiff).toBeLessThan(2);
    expect(report.largeShare).toBeLessThan(0.01);
    if ('borderColour' in variant.crop) {
      const hex = variant.crop.borderColour;
      expect(report.corner).toEqual([1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) * 257));
    }
    expect(report.jpegPrecision).toBe('rgb16');
    expect(report.jpegBits).toBe(8);
    expect(report.jpegSize).toEqual([300 / variant.sections, 240]);
  });
}

test('16-bit format export: split sections join to the one-pass 16-bit frame exactly', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Pure rendering; one project is enough.');
  await page.goto('/');
  const report = await page.evaluate(async () => {
    // @ts-ignore Browser module resolved by Vite dev server.
    const { renderV2Export } = await import('/src/v2/engineClient/renderV2Export.ts');
    // @ts-ignore Browser module resolved by Vite dev server.
    const { DEFAULT_CROP } = await import('/src/v2/engineClient/cropOps.ts');
    // @ts-ignore Browser module resolved by Vite dev server.
    const { readPng16 } = await import('/src/core/png16.ts');
    const width = 600, height = 200;
    const data = new Uint16Array(width * height * 3);
    for (let i = 0; i < width * height; i += 1) { data[i * 3] = 1001 + (i % width) * 101; data[i * 3 + 1] = 7 + Math.floor(i / width) * 311; data[i * 3 + 2] = 33333; }
    const precise = { width, height, data };
    const c = document.createElement('canvas'); c.width = width; c.height = height;
    const image = new Image(); image.src = c.toDataURL('image/png'); await image.decode();
    const frame = { id: 's16', filename: 'split16.png', isDemo: true, edit: { exposure: 0, warmth: 0, colour: 0 } } as Parameters<typeof renderV2Export>[1];
    const png = { id: 'p16', label: 'PNG', prefix: 'p_', width: 0, height: 0, quality: 1, format: 'png' as const };
    const crop = { ...DEFAULT_CROP, zoom: 1.1, panX: 3 };
    const date = new Date('2026-11-25T23:00:00.000Z');
    const one = await renderV2Export(image, frame, { width: 400, height: 160 }, crop, png, null, date, undefined, 1, precise);
    const two = await renderV2Export(image, frame, { width: 200, height: 160 }, crop, png, null, date, undefined, 2, precise);
    const whole = await readPng16(new Uint8Array(await one.file.arrayBuffer()));
    const [left, right] = await Promise.all(two.sections!.map(async (f: File) => readPng16(new Uint8Array(await f.arrayBuffer()))));
    let mismatches = 0;
    for (let y = 0; y < 160; y += 1) for (let x = 0; x < 400; x += 1) for (let ch = 0; ch < 3; ch += 1) {
      const side = x < 200 ? left : right, sx = x < 200 ? x : x - 200;
      if (whole.data[(y * 400 + x) * 3 + ch] !== side.data[(y * 200 + sx) * 3 + ch]) mismatches += 1;
    }
    return { mismatches, names: two.sections!.map((f: File) => f.name) };
  });
  expect(report.mismatches).toBe(0);
  expect(report.names).toEqual(['p_split16-01-of-02.png', 'p_split16-02-of-02.png']);
});

for (const variant of [
  { name: 'picture layers (normal and darken, turned, soft-edged)', upscale: undefined, layers: true, size: { width: 300, height: 240 } },
  { name: '2x Output scale enlargement', upscale: 2, layers: false, size: { width: 800, height: 600 } },
  { name: 'layers and 4x enlargement together', upscale: 4, layers: true, size: { width: 1200, height: 900 } },
] as const) {
  test('16-bit format export stays 16-bit to the file: ' + variant.name, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Pure rendering; one project is enough.');
    await page.goto('/');
    const report = await page.evaluate(async (settings) => {
      // @ts-ignore Browser module resolved by Vite dev server.
      const { renderV2Export } = await import('/src/v2/engineClient/renderV2Export.ts');
      // @ts-ignore Browser module resolved by Vite dev server.
      const { DEFAULT_CROP } = await import('/src/v2/engineClient/cropOps.ts');
      // @ts-ignore Browser module resolved by Vite dev server.
      const { readPng16 } = await import('/src/core/png16.ts');
      // @ts-ignore Browser module resolved by Vite dev server.
      const { looksEightBit } = await import('/src/core/compose16.ts');
      // @ts-ignore Browser module resolved by Vite dev server.
      const { ditherRgb16ToRgba8 } = await import('/src/core/rgb16Output.ts');
      // @ts-ignore Browser module resolved by Vite dev server.
      const { saveLayerAsset } = await import('/src/core/layerAssetVault.ts');

      const width = 240, height = 180;
      const data = new Uint16Array(width * height * 3);
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        const at = (y * width + x) * 3;
        data[at] = 3001 + x * 241; data[at + 1] = 7001 + y * 317; data[at + 2] = 61001 - x * 113 - y * 97;
      }
      const precise = { width, height, data };
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d')!.putImageData(new ImageData(ditherRgb16ToRgba8(precise), width, height), 0, 0);
      const image = new Image();
      image.src = canvas.toDataURL('image/png');
      await image.decode();

      let overlayRecord: unknown = undefined;
      if (settings.layers) {
        // Two synthetic layer images: a flat orange card and a two-tone stripe.
        const art = (paint: (c: CanvasRenderingContext2D) => void) => {
          const c = document.createElement('canvas'); c.width = 64; c.height = 48; paint(c.getContext('2d')!);
          return new Promise<Blob>((resolve) => c.toBlob((b) => resolve(b!), 'image/png'));
        };
        const orange = await saveLayerAsset(await art((c) => { c.fillStyle = '#e08030'; c.fillRect(0, 0, 64, 48); }));
        const stripe = await saveLayerAsset(await art((c) => { c.fillStyle = '#203040'; c.fillRect(0, 0, 32, 48); c.fillStyle = '#f0f0f0'; c.fillRect(32, 0, 32, 48); }));
        const base = { aspect: 0.75, hidden: false, shape: 'rectangle' as const };
        overlayRecord = { layers: [
          { ...base, id: 'l1', assetId: orange, label: 'card', x: 0.3, y: 0.35, width: 0.3, rotation: 20, opacity: 0.6, blend: 'normal', softEdge: 0.1 },
          { ...base, id: 'l2', assetId: stripe, label: 'stripe', x: 0.7, y: 0.65, width: 0.25, rotation: 0, opacity: 1, blend: 'darken', softEdge: 0, shape: 'oval' },
        ] };
      }
      const frame = { id: 'fl', filename: 'layers16.png', isDemo: true, overlay: overlayRecord,
        edit: { exposure: 0, warmth: 0, colour: 0, upscale: settings.upscale as 2 | 4 | undefined } } as Parameters<typeof renderV2Export>[1];
      const png = { id: 'p16', label: 'PNG', prefix: 'p_', width: 0, height: 0, quality: 1, format: 'png' as const };
      const crop = { ...DEFAULT_CROP };
      const date = new Date('2026-11-25T23:30:00.000Z');

      const result = await renderV2Export(image, frame, settings.size, crop, png, null, date, undefined, 1, precise);
      const picture = await readPng16(new Uint8Array(await result.file.arrayBuffer()));
      const plain = await renderV2Export(image, Object.assign({}, frame, { overlay: undefined }), settings.size, crop, png, null, date, undefined, 1, precise);
      const plainPicture = await readPng16(new Uint8Array(await plain.file.arrayBuffer()));
      const canvasResult = await renderV2Export(image, frame, settings.size, crop, png, null, date, undefined, 1);
      const bitmap = await createImageBitmap(canvasResult.file);
      const c = document.createElement('canvas'); c.width = bitmap.width; c.height = bitmap.height;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bitmap, 0, 0);
      const eight = ctx.getImageData(0, 0, c.width, c.height).data;
      let sum = 0, count = 0, large = 0, changedByLayers = 0;
      for (let p = 0; p < picture.width * picture.height; p += 1) {
        let changed = false;
        for (let ch = 0; ch < 3; ch += 1) {
          const diff = Math.abs(picture.data[p * 3 + ch] / 257 - eight[p * 4 + ch]);
          sum += diff; count += 1; if (diff > 24) large += 1;
          if (picture.data[p * 3 + ch] !== plainPicture.data[p * 3 + ch]) changed = true;
        }
        if (changed) changedByLayers += 1;
      }
      return {
        precision: result.precision, bits: result.bitsPerChannel, size: [picture.width, picture.height], canvasSize: [c.width, c.height],
        eightBit: looksEightBit(picture), meanDiff: sum / count, largeShare: large / count,
        layerShare: changedByLayers / (picture.width * picture.height),
      };
    }, { upscale: variant.upscale, layers: variant.layers, size: variant.size });

    expect(report.precision).toBe('rgb16');
    expect(report.bits).toBe(16);
    expect(report.eightBit).toBe(false);
    expect(report.size).toEqual(report.canvasSize);
    // Enlarged beyond the 240 x 180 picture when Output scale asks for it.
    if (variant.upscale) expect(report.size[0]).toBeGreaterThan(240);
    expect(report.meanDiff).toBeLessThan(2);
    expect(report.largeShare).toBeLessThan(0.01);
    // Layers change only part of the picture; without them the export is identical to the plain one.
    if (variant.layers) { expect(report.layerShare).toBeGreaterThan(0.02); expect(report.layerShare).toBeLessThan(0.5); }
    else expect(report.layerShare).toBe(0);
  });
}

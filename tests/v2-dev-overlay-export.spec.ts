import { expect, test, type Page } from '@playwright/test';

// Runs on the Vite dev server (`npm run test:e2e:dev`): the real export function (renderV2Export) is called in the page
// on a synthetic picture, and the files it returns are decoded and measured. Dave, 27 Nov (Windows, a Z5 II NEF with a
// two-line camera-info overlay): the exported border was grey where the preview's was white, the text ran off both
// edges of a 4:5 export, and on a 2-panel split it was drawn across the join instead of on the last panel.
// Rule: the export is what the preview shows.

type Run = { sections: { width: number; height: number; border: number[]; overlay: { x0: number; x1: number; y0: number; y1: number } | null }[] };

/** Exports once with the overlay and once without, and returns each section's border pixel and the box the overlay changed. */
async function exportBoth(page: Page, options: { width: number; height: number; sections: 1 | 2; border: number; precise: boolean; scrim?: boolean; cover?: boolean; jpeg?: boolean }): Promise<Run> {
  return page.evaluate(async (o) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { renderV2Export } = await load('/src/v2/engineClient/renderV2Export.ts');
    const { readOverlay } = await load('/src/v2/engineClient/overlayOps.ts');
    const { DEFAULT_CROP } = await load('/src/v2/engineClient/cropOps.ts');
    // A mid-blue 3:2 picture, like the NEF's shape: never white, grey or the text's colour.
    const W = 2400, H = 1604;
    const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgb(40, 90, 160)'; ctx.fillRect(0, 0, W, H);
    const source = new Image();
    source.src = canvas.toDataURL('image/png');
    await source.decode();
    let precise: { width: number; height: number; data: Uint16Array } | undefined;
    if (o.precise) {
      const data = new Uint16Array(W * H * 3);
      for (let i = 0; i < W * H; i += 1) { data[i * 3] = 40 * 257; data[i * 3 + 1] = 90 * 257; data[i * 3 + 2] = 160 * 257; }
      precise = { width: W, height: H, data };
    }
    const lines = ['Nikon Z5 II · Nikkor Z 100–400mm f/4.5–5.6 VR S', 'f/5 · 1/160s · ISO 1250 · STAFFORD'];
    const settings = readOverlay({
      textEnabled: true, textScrim: o.scrim !== false, textLayoutMode: o.cover ? 'cover-full' : 'as-is', textPosition: 'bottom-center',
      rows: lines.map((text, index) => ({ id: `r${index}`, fields: [], customText: text, fontId: 'jakarta', sizePx: 14, weight: 500, uppercase: false, letterSpacing: 0 })),
    });
    const overlay = { overlay: settings, text: true, watermark: false, contrast: 'light-on-dark' as const, mark: null,
      rows: lines.map((text) => ({ text, family: 'sans-serif', weight: 500, sizePx: 14, letterSpacing: 0 })) };
    const frame = { id: 'p', stableKey: 'k', filename: 'synthetic.png', exif: {} };
    const crop = { ...DEFAULT_CROP, borderWidth: o.border };
    const profile = { id: 'test', label: 'Test', prefix: '', width: o.width, height: o.height, quality: 0.92, format: (o.jpeg ? 'jpeg' : 'png') as 'jpeg' | 'png' };
    const run = async (withOverlay: boolean) => {
      const result = await renderV2Export(source, frame, { width: o.width, height: o.height }, crop, profile, withOverlay ? overlay : null, new Date(0), undefined, o.sections, precise);
      const files: File[] = result.sections ?? [result.file];
      return Promise.all(files.map(async (file) => {
        const bitmap = await createImageBitmap(file);
        const c = Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
        const x = c.getContext('2d', { willReadFrequently: true })!;
        x.drawImage(bitmap, 0, 0);
        return x.getImageData(0, 0, c.width, c.height);
      }));
    };
    const [plain, drawn] = [await run(false), await run(true)];
    return {
      sections: drawn.map((image, index) => {
        const base = plain[index].data, data = image.data, w = image.width, h = image.height;
        let x0 = w, x1 = -1, y0 = h, y1 = -1;
        for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
          const i = (y * w + x) * 4;
          if (Math.abs(data[i] - base[i]) + Math.abs(data[i + 1] - base[i + 1]) + Math.abs(data[i + 2] - base[i + 2]) > 24) {
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
        }
        // A pixel well inside the border band (when there is one): 1% in from the top-left corner.
        const bx = Math.max(1, Math.round(w * 0.01)), by = Math.max(1, Math.round(w * 0.01));
        const b = (by * w + bx) * 4;
        return { width: w, height: h, border: [data[b], data[b + 1], data[b + 2]], overlay: x1 < 0 ? null : { x0, x1, y0, y1 } };
      }),
    };
  }, options);
}

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The export is the same code on every screen; measured once.');
  await page.goto('/?v2', { waitUntil: 'domcontentloaded' });
});

for (const precise of [false, true]) {
  const path = precise ? '16-bit path (as a RAW exports)' : '8-bit path';

  test(`border: a 4:5 export's border is the colour chosen, white, with a text overlay on (${path})`, async ({ page }) => {
    const run = await exportBoth(page, { width: 1080, height: 1350, sections: 1, border: 5, precise });
    const [section] = run.sections;
    expect([section.width, section.height]).toEqual([1080, 1350]);
    expect(section.border, 'the border is white, as the preview shows it').toEqual([255, 255, 255]);
    // And as a JPEG, the format Dave exported.
    const jpeg = await exportBoth(page, { width: 1080, height: 1350, sections: 1, border: 5, precise, jpeg: true });
    for (const channel of jpeg.sections[0].border) expect(channel, 'the JPEG border is white').toBeGreaterThanOrEqual(253);
  });

  test(`text: the two lines sit inside the 4:5 frame, inside its edge margin (${path})`, async ({ page }) => {
    const run = await exportBoth(page, { width: 1080, height: 1350, sections: 1, border: 5, precise });
    const box = run.sections[0].overlay!;
    expect(box, 'the overlay was drawn').not.toBeNull();
    // The preview's edge margin is 4% of the frame's width; a little slack for anti-aliasing.
    const margin = 1080 * 0.04 - 2;
    expect(box.x0, `left edge of the text box (${JSON.stringify(box)})`).toBeGreaterThanOrEqual(margin);
    expect(box.x1, `right edge of the text box (${JSON.stringify(box)})`).toBeLessThanOrEqual(1080 - margin);
    expect(box.y1).toBeLessThanOrEqual(1350 - margin);
  });

  test(`split: on 2 panels the overlay is on the last panel only, placed inside it (${path})`, async ({ page }) => {
    const run = await exportBoth(page, { width: 1200, height: 800, sections: 2, border: 0, precise });
    expect(run.sections.length).toBe(2);
    const [first, last] = run.sections;
    expect(first.overlay, 'nothing of the overlay on panel 1').toBeNull();
    expect(last.overlay, 'the overlay is on panel 2').not.toBeNull();
    const margin = last.width * 0.04 - 2;
    expect(last.overlay!.x0).toBeGreaterThanOrEqual(margin);
    expect(last.overlay!.x1).toBeLessThanOrEqual(last.width - margin);
    // Centred on that panel, as the preview draws it (bottom centre).
    expect(Math.abs((last.overlay!.x0 + last.overlay!.x1) / 2 - last.width / 2)).toBeLessThanOrEqual(3);
    // The same size on a panel as on a single frame of that width: laid out by the panel, not by the stitched picture.
    const single = await exportBoth(page, { width: 1200, height: 800, sections: 1, border: 0, precise });
    const one = single.sections[0].overlay!;
    expect(Math.abs((last.overlay!.x1 - last.overlay!.x0) - (one.x1 - one.x0)), 'text width on the panel against a single frame').toBeLessThanOrEqual(2);
    expect(Math.abs(last.overlay!.y0 - one.y0)).toBeLessThanOrEqual(2);
  });
}

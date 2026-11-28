import assert from 'node:assert/strict';
import test from 'node:test';
import { createCollage, changeCollageTemplate, type CollageDocument } from './collage.ts';
import {
  CUSTOM_EDGE_MAX, CUSTOM_EDGE_MIN, checkCollageWindows, collagePageGeometry, collageSocialSize, customLongEdge, isPrintDpi, measureWindow,
} from './collageOutput.ts';

test('social pages export at their own size, twice it, or a chosen long edge, keeping their shape', () => {
  assert.deepEqual(collageSocialSize('square'), { width: 1080, height: 1080 });
  assert.deepEqual(collageSocialSize('portrait', { kind: 'x2' }), { width: 2160, height: 2700 });
  assert.deepEqual(collageSocialSize('landscape', { kind: 'custom', longEdge: 3840 }), { width: 3840, height: 2160 });
  assert.deepEqual(collageSocialSize('story', { kind: 'custom', longEdge: 10 }), { width: Math.round(1080 * CUSTOM_EDGE_MIN / 1920), height: CUSTOM_EDGE_MIN });
  assert.equal(customLongEdge(99999), CUSTOM_EDGE_MAX);
  assert.equal(customLongEdge(Number.NaN), null);
  assert.deepEqual(collageSocialSize('square', { kind: 'custom', longEdge: Number.NaN }), { width: 1080, height: 1080 });
  assert.throws(() => collageSocialSize('a4-portrait'), /social canvas/);
});

test('print resolution choices are 240, 300 and 360 DPI, and change the page pixels', () => {
  assert.ok(isPrintDpi(240) && isPrintDpi(300) && isPrintDpi(360));
  assert.ok(!isPrintDpi(72) && !isPrintDpi('300'));
  const at300 = collagePageGeometry({ format: 'a4-portrait' }, { kind: 'print', dpi: 300 });
  const at240 = collagePageGeometry({ format: 'a4-portrait' }, { kind: 'print', dpi: 240 });
  assert.ok(at300.width > at240.width);
  // 216 mm (A4 plus 3 mm bleed each side) at 300 DPI.
  assert.equal(at300.width, Math.ceil(216 * 300 / 25.4));
  assert.ok(Math.abs(at300.trimWidth - 210 * 300 / 25.4) < 2);
});

test('a window says how much its photograph is enlarged, and its zoom counts against the pixels', () => {
  const social = { kind: 'social', scale: { kind: 'x1' } } as const;
  assert.deepEqual(measureWindow({ width: 2000, height: 1000 }, { width: 500, height: 500 }, 1, social), { enlargement: 0.5, ppi: null, low: false });
  assert.deepEqual(measureWindow({ width: 400, height: 400 }, { width: 600, height: 300 }, 1, social), { enlargement: 1.5, ppi: null, low: true });
  assert.equal(measureWindow({ width: 1000, height: 1000 }, { width: 500, height: 500 }, 3, social).low, true, 'zoomed in three times');
  assert.deepEqual(measureWindow(null, { width: 500, height: 500 }, 1, social), { enlargement: null, ppi: null, low: false });
});

test('every window on the chosen pages is checked, with its page and window number, at the chosen output', () => {
  let doc: CollageDocument = createCollage(['big', 'small', 'unknown'], 'square');
  doc = changeCollageTemplate(doc, 'triptych');
  const sizes: Record<string, { width: number; height: number; filename: string }> = {
    big: { width: 6000, height: 4000, filename: 'big.nef' },
    small: { width: 300, height: 200, filename: 'small.jpg' },
  };
  const sizeOf = (id: string) => sizes[id] ?? null;
  const x1 = checkCollageWindows(doc, doc.pages, sizeOf, { kind: 'social', scale: { kind: 'x1' } });
  assert.deepEqual(x1.map((c) => [c.page, c.window, c.filename, c.low]), [[1, 1, 'big.nef', false], [1, 2, 'small.jpg', true], [1, 3, 'unknown', false]]);
  assert.equal(x1[2].sourcePx, null, 'an unknown size is not guessed');
  const x2 = checkCollageWindows(doc, doc.pages, sizeOf, { kind: 'social', scale: { kind: 'x2' } });
  assert.ok(x2[0].windowPx.width > x1[0].windowPx.width * 1.9);

  const album = createCollage(['big', 'small'], 'a4-portrait');
  const printed = checkCollageWindows(album, album.pages, sizeOf, { kind: 'print', dpi: 300 });
  const big = printed.find((c) => c.photoId === 'big')!, small = printed.find((c) => c.photoId === 'small')!;
  assert.equal(big.enlargement, null);
  assert.ok(big.ppi! > 0 && small.ppi! < 300 && small.low);
  // A lower print resolution can make a borderline window acceptable.
  const lower = checkCollageWindows(album, album.pages, sizeOf, { kind: 'print', dpi: 240 }).find((c) => c.photoId === 'big')!;
  assert.equal(lower.ppi, big.ppi, 'genuine pixels per inch do not depend on the chosen DPI');
});

test('a background photograph is checked as window 0 over the whole page', () => {
  const doc = createCollage(['a'], 'square');
  const withBackground: CollageDocument = { ...doc, pages: [{ ...doc.pages[0], backgroundPhotoId: 'bg' }] };
  const checks = checkCollageWindows(withBackground, withBackground.pages, (id) => (id === 'bg' ? { width: 800, height: 800, filename: 'bg.jpg' } : null),
    { kind: 'social', scale: { kind: 'x1' } });
  assert.deepEqual(checks[0].windowPx, { width: 1080, height: 1080 });
  assert.equal(checks[0].window, 0);
  assert.equal(checks[0].low, true);
});

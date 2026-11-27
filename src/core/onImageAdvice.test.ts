import assert from 'node:assert/strict';
import test from 'node:test';
import { clipChips, clippingMap, mergeCells, CLIP_SHOW_FROM } from './clippingMap.ts';
import { colourBadge } from './colourBadge.ts';
import { computeHistogram } from './histogram.ts';
import { measureOnImageAdvice, subjectWeights } from './onImageAdvice.ts';
import { resolveAdviceShown } from './adviceSetting.ts';
import type { ColourSenseResult } from './colourSense.ts';

function picture(width: number, height: number, fill: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const [r, g, b] = fill(x, y);
    data.set([r, g, b, 255], (y * width + x) * 4);
  }
  return { width, height, data };
}

test('the clipped share is the histogram’s own number', () => {
  const pixels = picture(40, 40, (x) => (x < 10 ? [255, 255, 255] : [120, 110, 100]));
  const map = clippingMap(pixels)!;
  const histogram = computeHistogram(pixels.data);
  assert.equal(map.highlightShare, histogram.highlightClip);
  assert.equal(map.shadowShare, histogram.shadowClip);
  assert.equal(map.highlightShare, 0.25);
});

test('a clipped block is outlined where it is, as one rectangle in picture fractions', () => {
  const pixels = picture(96, 96, (x, y) => (x >= 48 && y < 48 ? [255, 255, 255] : [100, 100, 100]));
  const map = clippingMap(pixels)!;
  assert.equal(map.highlights.length, 1);
  const [region] = map.highlights;
  assert.ok(Math.abs(region.x - 0.5) < 1e-9 && region.y === 0 && Math.abs(region.width - 0.5) < 1e-9 && Math.abs(region.height - 0.5) < 1e-9);
  assert.deepEqual(map.shadows, []);
});

test('shadows are found separately from highlights', () => {
  const pixels = picture(96, 96, (x) => (x < 24 ? [0, 0, 0] : [140, 140, 140]));
  const map = clippingMap(pixels)!;
  assert.equal(map.highlights.length, 0);
  assert.equal(map.shadows.length, 1);
  assert.ok(Math.abs(map.shadows[0].width - 0.25) < 1e-9);
});

test('a clean picture has no clip and no chips', () => {
  const map = clippingMap(picture(30, 30, () => [100, 120, 140]))!;
  assert.deepEqual(map.highlights, []);
  assert.deepEqual(clipChips(map), []);
});

test('invalid pixels give no map rather than a guess', () => {
  assert.equal(clippingMap({ width: 4, height: 4, data: new Uint8ClampedArray(8) }), null);
  assert.deepEqual(clipChips(null), []);
});

test('chips say the share in whole percent, highlights first, and only from 1%', () => {
  assert.deepEqual(clipChips({ highlightShare: 0.034, shadowShare: 0.2 }), [{ kind: 'highlights', percent: 3 }, { kind: 'shadows', percent: 20 }]);
  assert.deepEqual(clipChips({ highlightShare: CLIP_SHOW_FROM - 0.001, shadowShare: 0 }), []);
  assert.deepEqual(clipChips({ highlightShare: 0.0101, shadowShare: Number.NaN }), [{ kind: 'highlights', percent: 1 }]);
});

test('scattered speckle is counted in the share but never outlined as a block', () => {
  // One clipped pixel in every second cell column and row: no cell reaches a quarter clipped.
  const pixels = picture(96, 96, (x, y) => (x % 4 === 0 && y % 4 === 0 ? [255, 255, 255] : [90, 90, 90]));
  const map = clippingMap(pixels)!;
  assert.ok(map.highlightShare > 0.05);
  assert.deepEqual(map.highlights, []);
});

test('touching cells merge, separate blocks stay separate', () => {
  const flags = Uint8Array.from([
    1, 1, 0, 0,
    1, 1, 0, 1,
    0, 0, 0, 1,
  ]);
  const rects = mergeCells(flags, 4, 3).sort((a, b) => a.col - b.col);
  assert.deepEqual(rects, [{ col: 0, row: 0, cols: 2, rows: 2 }, { col: 3, row: 1, cols: 1, rows: 2 }]);
});

type Measured = Exclude<ColourSenseResult, { verdict: 'unknown' }>;
const kept: Measured = { verdict: 'kept', before: 'blue', after: 'blue', nearGrey: false, hueShift: 2, saturationChange: 0.05, newlyClipped: { red: 0, green: 0, blue: 0 }, outside: [] };
const changed = (over: Partial<Measured>): ColourSenseResult => ({ ...kept, verdict: 'changed', outside: ['saturation'], saturationChange: 0.3, ...over });

test('the colour badge names kept, a small move, a big move and not-judged, each with its own shape', () => {
  assert.deepEqual(colourBadge(kept), { kind: 'kept', shape: 'tick', aspects: [] });
  assert.equal(colourBadge(changed({})).kind, 'adjusted');
  assert.equal(colourBadge(changed({})).shape, 'diamond');
  assert.equal(colourBadge(changed({ saturationChange: 0.6 })).kind, 'review');
  assert.equal(colourBadge(changed({ outside: ['hue'], hueShift: 25, saturationChange: 0 })).kind, 'review');
  assert.equal(colourBadge(changed({ outside: ['hue'], hueShift: 14, saturationChange: 0 })).kind, 'adjusted');
  assert.equal(colourBadge(changed({ outside: ['clipping'], newlyClipped: { red: 0.05, green: 0, blue: 0 }, saturationChange: 0 })).kind, 'review');
  assert.equal(colourBadge(changed({ outside: ['saturation'], nearGrey: true, hueShift: null, saturationChange: 0.1 })).kind, 'review');
  assert.deepEqual(colourBadge({ verdict: 'unknown', reason: 'noSubject' }), { kind: 'unsure', shape: 'ring', aspects: [] });
  assert.equal(colourBadge(undefined).kind, 'unsure');
  const shapes = new Set([colourBadge(kept).shape, colourBadge(changed({})).shape, colourBadge(changed({ saturationChange: 0.6 })).shape, colourBadge(null).shape]);
  assert.equal(shapes.size, 4, 'each verdict has a different shape, so colour is never the only cue');
});

test('subject weights cover the box and nothing else; no box means no weights', () => {
  const weights = subjectWeights({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, 8, 8)!;
  assert.equal(weights.reduce((sum, value) => sum + value, 0), 16);
  assert.equal(weights[0], 0);
  assert.equal(subjectWeights(null, 8, 8), null);
  assert.equal(subjectWeights({ x: 0, y: 0, width: 0, height: 1 }, 8, 8), null);
  assert.equal(subjectWeights({ x: Number.NaN, y: 0, width: 1, height: 1 }, 8, 8), null);
});

test('measuring an unedited picture keeps the colour; an edit that blows the subject out is flagged', () => {
  const before = picture(64, 64, () => [180, 90, 60]);
  const box = { x: 0.2, y: 0.2, width: 0.6, height: 0.6 };
  const same = measureOnImageAdvice(before, before, box);
  assert.equal(colourBadge(same.colour).kind, 'kept');
  assert.equal(same.clipping?.highlightShare, 0);
  const after = picture(64, 64, () => [255, 40, 0]);
  const edited = measureOnImageAdvice(before, after, box);
  assert.equal(colourBadge(edited.colour).kind, 'review');
  assert.ok((edited.clipping?.highlightShare ?? 0) > 0.9);
  assert.equal(measureOnImageAdvice(before, before, null).colour.verdict, 'unknown');
});

test('the advice layer is on in Solo and off elsewhere until the person chooses, and their choice wins', () => {
  assert.equal(resolveAdviceShown(null, 'solo'), true);
  assert.equal(resolveAdviceShown(null, 'copilot'), false);
  assert.equal(resolveAdviceShown(null, 'autopilot'), false);
  assert.equal(resolveAdviceShown('off', 'solo'), false);
  assert.equal(resolveAdviceShown('on', 'autopilot'), true);
});

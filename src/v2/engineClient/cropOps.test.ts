import assert from 'node:assert/strict';
import test from 'node:test';
import { proposeCrop } from '../../core/proposeCrop.ts';
import { DEFAULT_CROP, DEFAULT_CROP as UNTOUCHED, cropPatchForRect, isUntouchedCrop, flipCrop, patchCrop, readCrops, rotateCrop, sanitiseCrop } from './cropOps.ts';

test('a photo with no stored crops has none, and a damaged value falls back to the default', () => {
  assert.deepEqual(readCrops(undefined), {});
  assert.deepEqual(readCrops([1, 2]), {});
  assert.deepEqual(sanitiseCrop('x'), DEFAULT_CROP);
});

test('zoom, position, insets and rotation are held inside their ranges', () => {
  const crop = sanitiseCrop({ zoom: 99, panX: 9999, panY: -9999, insetTop: 80, rotateDeg: 45, flipH: 'yes' });
  assert.equal(crop.zoom, 8);
  assert.equal(crop.panX, 400);
  assert.equal(crop.panY, -400);
  assert.equal(crop.insetTop, 30);
  assert.equal(crop.rotateDeg, 0);
  assert.equal(crop.flipH, false);
  assert.equal(sanitiseCrop({ zoom: 0.2 }).zoom, 1, 'never zoomed out past the picture');
});

test('each format keeps its own crop, patched, flipped and rotated', () => {
  const stored = readCrops({ ig: { zoom: 2, panX: 10 }, yt: { zoom: 1.5 } });
  assert.equal(stored.ig.zoom, 2);
  assert.equal(stored.yt.panX, 0);
  assert.equal(patchCrop(stored.ig, { zoom: 3 }).panX, 10, 'a patch keeps the rest');
  assert.equal(flipCrop(undefined, 'horizontal').flipH, true);
  assert.equal(flipCrop(flipCrop(undefined, 'vertical'), 'vertical').flipV, false);
  assert.equal(rotateCrop(rotateCrop(undefined)).rotateDeg, 180);
  assert.equal(rotateCrop({ ...DEFAULT_CROP, rotateDeg: 270 }).rotateDeg, 0);
});

test('a border is kept within 0 to 10 percent and a valid colour; anything else falls back to none and white', () => {
  assert.equal(sanitiseCrop({ borderWidth: 4, borderColour: '#AABBCC' }).borderWidth, 4);
  assert.equal(sanitiseCrop({ borderWidth: 4, borderColour: '#AABBCC' }).borderColour, '#aabbcc');
  assert.equal(sanitiseCrop({ borderWidth: 99 }).borderWidth, 10);
  assert.equal(sanitiseCrop({ borderWidth: -3 }).borderWidth, 0);
  assert.equal(sanitiseCrop({ borderWidth: 'x' }).borderWidth, 0);
  assert.equal(sanitiseCrop({ borderColour: 'red; background:url(x)' }).borderColour, '#ffffff');
  assert.equal(sanitiseCrop(undefined).borderWidth, 0);
  assert.equal(patchCrop(undefined, { borderWidth: 2, borderColour: '#000000' }).borderColour, '#000000');
});

test('each format safely retains a border placement without leaking malformed values', () => {
  for (const placement of ['all', 'horizontal', 'vertical', 'auto'] as const) {
    assert.equal(sanitiseCrop({ borderPlacement: placement }).borderPlacement, placement);
  }
  assert.equal(sanitiseCrop({ borderPlacement: 'inset;overflow:hidden' }).borderPlacement, 'all');
  assert.equal(patchCrop(undefined, { borderPlacement: 'vertical', borderColour: '#DDCCAA' }).borderPlacement, 'vertical');
});

test('invalid and inherited format keys are discarded on reopen', () => {
  const stored = readCrops(JSON.parse('{"__proto__":{"zoom":3},"constructor":{"zoom":2},"bad/id":{"zoom":5},"ig-portrait":{"zoom":2}}'));
  assert.deepEqual(Object.keys(stored), ['ig-portrait']);
  assert.equal(stored['ig-portrait'].zoom, 2);
});

test('a crop suggestion becomes one zoom and pan patch that shows that rectangle', () => {
  const picture = 3 / 2;
  const rect = proposeCrop({ box: { x0: 0.1, y0: 0.55, x1: 0.28, y1: 0.8 }, imageWidth: 6000, imageHeight: 4000 })!;
  const patch = cropPatchForRect(rect, picture, picture)!;
  const w = 1 / patch.zoom!;
  assert.ok(Math.abs(w - (rect.x1 - rect.x0)) < 1e-9);
  // the window centre the pan implies is the rectangle's centre
  assert.ok(Math.abs(0.5 - (patch.panX! / 100) * w - (rect.x0 + rect.x1) / 2) < 1e-9);
  assert.ok(Math.abs(0.5 - (patch.panY! / 100) * w - (rect.y0 + rect.y1) / 2) < 1e-9);
  assert.equal(cropPatchForRect(rect, 0, 1), null);
});

test('only an untouched crop is offered a suggestion', () => {
  assert.equal(isUntouchedCrop(undefined), true);
  assert.equal(isUntouchedCrop(UNTOUCHED), true);
  assert.equal(isUntouchedCrop({ ...UNTOUCHED, zoom: 1.2 }), false);
  assert.equal(isUntouchedCrop({ ...UNTOUCHED, flipH: true }), false);
});

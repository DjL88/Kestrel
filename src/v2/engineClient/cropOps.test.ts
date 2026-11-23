import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CROP, flipCrop, patchCrop, readCrops, rotateCrop, sanitiseCrop } from './cropOps.ts';

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

import assert from 'node:assert/strict';
import test from 'node:test';
import { planBorderFrame } from './borderFrameLayout.ts';

test('a square photo in a portrait 4:5 canvas receives top and bottom background, without crop', () => {
  const out = planBorderFrame(1080, 1350, 1080, 1080, { placement: 'auto' });
  assert.deepEqual(out.photo, { x: 0, y: 135, width: 1080, height: 1080 });
  assert.deepEqual(out.bands, [
    { x: 0, y: 0, width: 1080, height: 135 },
    { x: 0, y: 1215, width: 1080, height: 135 },
  ]);
  assert.equal(out.upscales, false);
});

test('solid border is inside canvas and shrinks photo, rather than obscuring it', () => {
  const out = planBorderFrame(1000, 750, 1000, 750, { placement: 'all', borderPercent: 5 });
  assert.deepEqual(out.inner, { x: 50, y: 50, width: 900, height: 650 });
  assert.deepEqual(out.photo, { x: 67, y: 50, width: 866, height: 650 });
  assert.ok(out.bands.every(b => b.width > 0 && b.height > 0));
});

test('horizontal-only and vertical-only padding can be chosen independently', () => {
  assert.deepEqual(planBorderFrame(1200, 900, 1200, 900, { placement: 'horizontal', borderPercent: 5 }).inner,
    { x: 0, y: 60, width: 1200, height: 780 });
  assert.deepEqual(planBorderFrame(1200, 900, 1200, 900, { placement: 'vertical', borderPercent: 5 }).inner,
    { x: 60, y: 0, width: 1080, height: 900 });
});

test('zero border keeps matching photo entirely unchanged', () => {
  const out = planBorderFrame(3000, 2000, 3000, 2000);
  assert.deepEqual(out.photo, { x: 0, y: 0, width: 3000, height: 2000 });
  assert.deepEqual(out.bands, []);
});

test('large output warns about upscaling without claiming additional resolution', () => {
  const out = planBorderFrame(4000, 5000, 500, 500, { placement: 'auto' });
  assert.equal(out.upscales, true);
  assert.equal(out.scale, 8);
  assert.deepEqual(out.photo, { x: 0, y: 500, width: 4000, height: 4000 });
});

test('bad border sizes or dimensions never create invalid geometry', () => {
  assert.throws(() => planBorderFrame(0, 100, 100, 100));
  assert.throws(() => planBorderFrame(100, 100, 100, 100, { borderPercent: 11 }));
  assert.throws(() => planBorderFrame(100, 100, 100, 100, { borderPercent: Number.NaN }));
  assert.throws(() => planBorderFrame(10, 1, 100, 100, { borderPercent: 10 }));
});

test('cover remains explicit and does not use background bars', () => {
  const out = planBorderFrame(1080, 1350, 1080, 1080, { placement: 'auto', fit: 'cover' });
  assert.deepEqual(out.photo, out.output);
  assert.deepEqual(out.bands, []);
});

test('inside solid border reserves a photo viewport instead of overlaying source pixels', () => {
  const layout = planBorderFrame(1080, 1350, 4000, 3000, { borderPercent: 5, fit: 'cover' });
  assert.deepEqual(layout.output, { x: 0, y: 0, width: 1080, height: 1350 });
  assert.deepEqual(layout.inner, { x: 54, y: 54, width: 972, height: 1242 });
  assert.deepEqual(layout.photo, layout.inner);
  assert.equal(layout.bands.length, 4);
  // No output pixel is outside the constant 1080 × 1350 format.
  assert.ok(layout.bands.every((rect) => rect.x >= 0 && rect.y >= 0 &&
    rect.x + rect.width <= layout.output.width && rect.y + rect.height <= layout.output.height));
});

test('a zero-width border preserves the full photo viewport for ordinary export', () => {
  const layout = planBorderFrame(2160, 1350, 6000, 4000, { borderPercent: 0, fit: 'cover' });
  assert.deepEqual(layout.inner, layout.output);
  assert.equal(layout.bands.length, 0);
});

test('two split panel interiors sample adjacent pixels without duplicated content at a seam', () => {
  const one = planBorderFrame(1080, 1350, 4000, 3000, { borderPercent: 5, fit: 'cover' });
  const fullInnerWidth = one.inner.width * 2;
  const samples = [0, 1].map((index) => ({
    sourceX: index * one.inner.width,
    destinationX: index * 1080 + one.inner.x,
    width: one.inner.width,
    y: one.inner.y,
  }));
  assert.deepEqual(samples, [
    { sourceX: 0, destinationX: 54, width: 972, y: 54 },
    { sourceX: 972, destinationX: 1134, width: 972, y: 54 },
  ]);
  assert.equal(samples[1].sourceX, samples[0].sourceX + samples[0].width);
  assert.equal(samples[1].sourceX + samples[1].width, fullInnerWidth);
});

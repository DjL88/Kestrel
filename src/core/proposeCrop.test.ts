import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_ENLARGEMENT, proposeCrop } from './proposeCrop';

const W = 6000, H = 4000;
const small = { x0: 0.1, y0: 0.55, x1: 0.28, y1: 0.8 };
const inside = (outer: { x0: number; y0: number; x1: number; y1: number }, inner = small) =>
  outer.x0 <= inner.x0 && outer.y0 <= inner.y0 && outer.x1 >= inner.x1 && outer.y1 >= inner.y1;

test('no subject, an empty box or a bad size gives no suggestion', () => {
  assert.equal(proposeCrop({ box: null, imageWidth: W, imageHeight: H }), null);
  assert.equal(proposeCrop({ box: undefined, imageWidth: W, imageHeight: H }), null);
  assert.equal(proposeCrop({ box: { x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.6 }, imageWidth: W, imageHeight: H }), null);
  assert.equal(proposeCrop({ box: small, imageWidth: 0, imageHeight: H }), null);
});

test('a small subject gets a tighter crop that keeps the whole subject', () => {
  const crop = proposeCrop({ box: small, imageWidth: W, imageHeight: H });
  assert.ok(crop);
  assert.ok(inside(crop));
  assert.ok(crop.x0 >= 0 && crop.y0 >= 0 && crop.x1 <= 1 && crop.y1 <= 1);
  assert.ok(crop.enlargement > 1);
});

test('the crop keeps the frame shape', () => {
  for (const aspect of [1.5, 1, 4 / 5, 16 / 9]) {
    const crop = proposeCrop({ box: small, imageWidth: W, imageHeight: H, aspect });
    assert.ok(crop, `aspect ${aspect}`);
    assert.ok(Math.abs(((crop.x1 - crop.x0) * W) / ((crop.y1 - crop.y0) * H) - aspect) < 1e-6);
    assert.ok(inside(crop));
  }
});

test('it never enlarges past the stated limit', () => {
  const speck = { x0: 0.45, y0: 0.45, x1: 0.47, y1: 0.47 };
  const crop = proposeCrop({ box: speck, imageWidth: W, imageHeight: H });
  assert.ok(crop);
  assert.ok(crop.enlargement <= MAX_ENLARGEMENT + 1e-9);
  assert.ok(inside(crop, speck));
});

test('a subject facing right gets room ahead of it, facing left the reverse', () => {
  const box = { x0: 0.4, y0: 0.4, x1: 0.55, y1: 0.65 };
  const right = proposeCrop({ box, imageWidth: W, imageHeight: H, facing: 'right' });
  const left = proposeCrop({ box, imageWidth: W, imageHeight: H, facing: 'left' });
  assert.ok(right && left);
  const share = (c: typeof right) => (((box.x0 + box.x1) / 2) - c.x0) / (c.x1 - c.x0);
  assert.ok(Math.abs(share(right) - 1 / 3) < 0.05);
  assert.ok(Math.abs(share(left) - 2 / 3) < 0.05);
  assert.ok(inside(right, box) && inside(left, box));
});

test('a subject touching the picture edge is never cut', () => {
  const edge = { x0: 0, y0: 0.3, x1: 0.2, y1: 0.7 };
  const crop = proposeCrop({ box: edge, imageWidth: W, imageHeight: H });
  if (crop) assert.ok(inside(crop, edge));
});

test('an already well framed or very large subject gives no suggestion', () => {
  assert.equal(proposeCrop({ box: { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 }, imageWidth: W, imageHeight: H }), null);
  assert.equal(proposeCrop({ box: { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.8 }, imageWidth: W, imageHeight: H }), null);
});

test('a subject too wide for the frame shape gives no suggestion rather than a cut subject', () => {
  assert.equal(proposeCrop({ box: { x0: 0.0, y0: 0.4, x1: 1, y1: 0.6 }, imageWidth: W, imageHeight: H, aspect: 1 }), null);
});

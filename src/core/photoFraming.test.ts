import test from 'node:test';
import assert from 'node:assert/strict';
import { cropRectangle, DEFAULT_FRAMING, detailAnchor } from './photoFraming';

test('a crop stays inside the source even when the anchor is off-centre', () => {
  assert.deepEqual(cropRectangle(1200, 800, { ...DEFAULT_FRAMING, ratio: 1, x: 0.9 }), {
    x: 400, y: 0, width: 800, height: 800,
  });
  assert.deepEqual(cropRectangle(800, 1200, DEFAULT_FRAMING), { x: 0, y: 0, width: 800, height: 1200 });
});

test('local crop anchor defaults to the centre for a flat image', () => {
  assert.deepEqual(detailAnchor(new Uint8ClampedArray(64 * 64 * 4).fill(128), 64, 64), { x: 0.5, y: 0.5 });
});

test('straightening coverage keeps every output corner inside the rotated source', async () => {
  const { rotationCoverage } = await import('./photoFraming');
  for (const [width, height] of [[6000, 4000], [4000, 6000], [5000, 5000]]) {
    for (const degrees of [-12, -5, 0, 4, 12]) {
      const angle = degrees * Math.PI / 180;
      const coverage = rotationCoverage(width, height, angle);
      for (const x of [-width / 2, width / 2]) {
        for (const y of [-height / 2, height / 2]) {
          const sourceX = (x * Math.cos(angle) + y * Math.sin(angle)) / coverage;
          const sourceY = (y * Math.cos(angle) - x * Math.sin(angle)) / coverage;
          assert.ok(Math.abs(sourceX) <= width / 2 + 1e-8);
          assert.ok(Math.abs(sourceY) <= height / 2 + 1e-8);
        }
      }
    }
  }
});

test('auto-level accepts a strong horizon and skips a flat photo', async () => {
  const { estimateLevel, thirdsCropAnchor } = await import('./photoFraming');
  const width = 112;
  const height = 78;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const level = y > 40 + Math.tan(7 * Math.PI / 180) * (x - width / 2) ? 220 : 35;
      pixels.set([level, level, level, 255], (y * width + x) * 4);
    }
  }
  const correction = estimateLevel(pixels, width, height);
  assert.ok(correction !== null && Math.abs(correction + 7) <= 2, String(correction));
  assert.equal(estimateLevel(pixels.fill(128), width, height), null);
  assert.equal(thirdsCropAnchor(1200, 800, 1, { x: 0.5, y: 0.5 }).x, 0.5);
  const anchor = thirdsCropAnchor(1200, 800, 1, { x: 0.35, y: 0.5 });
  const crop = cropRectangle(1200, 800, { ...DEFAULT_FRAMING, ...anchor, ratio: 1 });
  assert.ok(Math.abs((420 - crop.x) / crop.width - 1 / 3) < 0.01);
});

import { resizeCrop, DEFAULT_FRAMING as FRAMING } from './photoFraming';

test('a smaller size shrinks the crop box and keeps its ratio', () => {
  const full = cropRectangle(6000, 4000, { ...FRAMING, ratio: 1.5 });
  const half = cropRectangle(6000, 4000, { ...FRAMING, ratio: 1.5, size: 0.5 });
  assert.equal(half.width, full.width / 2);
  assert.ok(Math.abs(half.width / half.height - 1.5) < 0.01);
});

test('dragging the bottom-right corner in keeps the top-left corner and the ratio', () => {
  const framing = resizeCrop(6000, 4000, { ...FRAMING, ratio: 1.5 }, 'br', { x: 4000, y: 2500 });
  const box = cropRectangle(6000, 4000, framing);
  assert.equal(box.x, 0);
  assert.equal(box.y, 0);
  assert.ok(Math.abs(box.width / box.height - 1.5) < 0.01);
  assert.ok(box.width < 6000);
});

test('the opposite corner stays fixed whichever corner is dragged', () => {
  const start = cropRectangle(6000, 4000, { ...FRAMING, ratio: 1, size: 0.6 });
  for (const corner of ['tl', 'tr', 'bl', 'br'] as const) {
    const framing = resizeCrop(6000, 4000, { ...FRAMING, ratio: 1, size: 0.6 }, corner, {
      x: corner.endsWith('l') ? start.x + start.width * 0.3 : start.x + start.width * 0.7,
      y: corner.startsWith('t') ? start.y + start.height * 0.3 : start.y + start.height * 0.7,
    });
    const box = cropRectangle(6000, 4000, framing);
    const fixedX = corner.endsWith('l') ? start.x + start.width : start.x;
    const fixedY = corner.startsWith('t') ? start.y + start.height : start.y;
    const gotX = corner.endsWith('l') ? box.x + box.width : box.x;
    const gotY = corner.startsWith('t') ? box.y + box.height : box.y;
    assert.ok(Math.abs(gotX - fixedX) <= 2, `${corner} x`);
    assert.ok(Math.abs(gotY - fixedY) <= 2, `${corner} y`);
    assert.ok(box.width < start.width);
  }
});

test('the box cannot be dragged outside the photo or smaller than the minimum', () => {
  const out = resizeCrop(6000, 4000, { ...FRAMING, ratio: 1.5, size: 0.5, x: 0.5, y: 0.5 }, 'br', { x: 99999, y: 99999 });
  const box = cropRectangle(6000, 4000, out);
  assert.ok(box.x + box.width <= 6000 && box.y + box.height <= 4000);
  const tiny = resizeCrop(6000, 4000, { ...FRAMING, ratio: 1.5 }, 'br', { x: 0, y: 0 });
  assert.ok(tiny.size! >= 0.08);
});

test('with no ratio chosen, the first drag locks the photo’s own ratio', () => {
  const framing = resizeCrop(6000, 4000, FRAMING, 'tl', { x: 1500, y: 1000 });
  assert.equal(framing.ratio, 1.5);
  assert.ok(framing.size! < 1);
});

import { displayFramingFor } from './photoFraming';

test('the preview keeps the crop size once the crop tool is closed, and shows the whole photo while it is open', () => {
  const saved = { ...FRAMING, ratio: 1.5, size: 0.5, x: 0.3, y: 0.6 };
  assert.equal(displayFramingFor(saved, false).size, 0.5);
  assert.equal(displayFramingFor(saved, false).x, 0.3);
  const open = displayFramingFor(saved, true);
  assert.equal(open.ratio, null);
  assert.equal(open.size, undefined);
  assert.equal(cropRectangle(6000, 4000, open).width, 6000);
  assert.ok(cropRectangle(6000, 4000, displayFramingFor(saved, false)).width < 6000);
});

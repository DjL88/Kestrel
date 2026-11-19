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

import { drawCrop, fixedShape, resizeCropEdge } from './photoFraming';

test('with an open shape, pulling one edge moves only that edge', () => {
  for (const edge of ['top', 'bottom', 'left', 'right'] as const) {
    const pointer = { top: { x: 0, y: 1000 }, bottom: { x: 0, y: 3000 }, left: { x: 1500, y: 0 }, right: { x: 4500, y: 0 } }[edge];
    const framing = resizeCropEdge(6000, 4000, FRAMING, edge, pointer);
    const box = cropRectangle(6000, 4000, framing);
    const expected = {
      top: { x: 0, y: 1000, width: 6000, height: 3000 }, bottom: { x: 0, y: 0, width: 6000, height: 3000 },
      left: { x: 1500, y: 0, width: 4500, height: 4000 }, right: { x: 0, y: 0, width: 4500, height: 4000 },
    }[edge];
    for (const key of ['x', 'y', 'width', 'height'] as const) assert.ok(Math.abs(box[key] - expected[key]) <= 1, `${edge} ${key}: ${box[key]}`);
    assert.equal(framing.free, true, 'the list then reads Free');
  }
});

test('with a named ratio, pulling an edge keeps the ratio and the opposite edge', () => {
  const start = { ...FRAMING, ratio: 4 / 5, size: 0.8 };
  const before = cropRectangle(6000, 4000, start);
  const framing = resizeCropEdge(6000, 4000, start, 'top', { x: 0, y: before.y + 600 });
  const box = cropRectangle(6000, 4000, framing);
  assert.ok(Math.abs(box.width / box.height - 0.8) < 0.01);
  assert.ok(Math.abs(box.y + box.height - (before.y + before.height)) <= 1, 'bottom stays');
  assert.ok(Math.abs(box.height - (before.height - 600)) <= 1);
  assert.ok(Math.abs(box.x + box.width / 2 - (before.x + before.width / 2)) <= 1, 'stays centred across');
  assert.ok(fixedShape(framing) && !framing.free);
});

test('an edge cannot pass the opposite edge or leave the photo', () => {
  const squashed = cropRectangle(6000, 4000, resizeCropEdge(6000, 4000, FRAMING, 'top', { x: 0, y: 99999 }));
  assert.ok(squashed.height >= 4000 * 0.08 - 1 && squashed.y + squashed.height <= 4000);
  const square = { ...FRAMING, ratio: 1, size: 0.5 };
  const grown = cropRectangle(6000, 4000, resizeCropEdge(6000, 4000, square, 'right', { x: 99999, y: 0 }));
  assert.ok(grown.x >= 0 && grown.y >= 0 && grown.x + grown.width <= 6000 && grown.y + grown.height <= 4000);
  assert.ok(Math.abs(grown.width - grown.height) <= 1);
});

test('drawing a box gives exactly the dragged rectangle, in any direction', () => {
  const forward = cropRectangle(6000, 4000, drawCrop(6000, 4000, FRAMING, { x: 1000, y: 500 }, { x: 4000, y: 2500 }));
  const backward = cropRectangle(6000, 4000, drawCrop(6000, 4000, FRAMING, { x: 4000, y: 2500 }, { x: 1000, y: 500 }));
  for (const box of [forward, backward]) {
    assert.ok(Math.abs(box.x - 1000) <= 1 && Math.abs(box.y - 500) <= 1, JSON.stringify(box));
    assert.ok(Math.abs(box.width - 3000) <= 1 && Math.abs(box.height - 2000) <= 1, JSON.stringify(box));
  }
});

test('drawing keeps a named ratio, stays inside the photo and above the minimum', () => {
  const framing = drawCrop(6000, 4000, { ...FRAMING, ratio: 1 }, { x: 5000, y: 3000 }, { x: 9000, y: 3100 });
  const box = cropRectangle(6000, 4000, framing);
  assert.ok(Math.abs(box.width - box.height) <= 1);
  assert.ok(box.x + box.width <= 6000 && box.y + box.height <= 4000);
  assert.equal(framing.ratio, 1);
  const dot = cropRectangle(6000, 4000, drawCrop(6000, 4000, FRAMING, { x: 100, y: 100 }, { x: 101, y: 101 }));
  assert.ok(dot.width >= 6000 * 0.08 - 1 && dot.height >= 4000 * 0.08 - 1);
});

test('only a ratio chosen from the list fixes the shape', () => {
  assert.equal(fixedShape(FRAMING), false);
  assert.equal(fixedShape({ ...FRAMING, ratio: 1.5 }), true);
  assert.equal(fixedShape({ ...FRAMING, ratio: 1.5, free: true }), false);
  assert.equal(fixedShape({ ...FRAMING, ratio: 4 / 3 }), false, 'a shape no list entry names stays open');
});

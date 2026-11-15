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

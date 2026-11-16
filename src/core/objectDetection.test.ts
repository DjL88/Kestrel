import assert from 'node:assert/strict';
import test from 'node:test';
import { OUTPUT_ROWS, boxSharpness, decodeTile, mergeDetections, tilePlan, tileScale } from './objectDetection.ts';

test('a normal photo is looked at whole, and a big one is searched in overlapping tiles that cover all of it', () => {
  assert.equal(tilePlan(2000, 1300).length, 1);
  const tiles = tilePlan(8256, 5504);
  assert.deepEqual(tiles[0], { x: 0, y: 0, w: 8256, h: 5504 });
  assert.ok(tiles.length > 8 && tiles.length < 20, `${tiles.length} areas`);
  const covered = tiles.slice(1);
  assert.equal(Math.min(...covered.map((t) => t.x)), 0);
  assert.equal(Math.max(...covered.map((t) => t.x + t.w)), 8256);
  assert.equal(Math.max(...covered.map((t) => t.y + t.h)), 5504);
  assert.ok(covered.every((t) => t.w <= 2800 && t.h <= 2800), 'no tile is so big that a distant subject would shrink to nothing');
});

test('the model output is decoded back into photo pixels, and only subjects that matter are kept', () => {
  const output = new Float32Array(OUTPUT_ROWS * 85);
  // One strong aeroplane (class 4) at the first stride-8 cell (gx=10, gy=20): centre (x+gx)*8, size exp(w)*8.
  const row = 20 * 52 + 10;
  output.set([0.5, 0.5, Math.log(4), Math.log(2), 0.9], row * 85);
  output[row * 85 + 5 + 4] = 0.9;
  // A chair (class 56) must be ignored.
  const chair = 30 * 52 + 30;
  output.set([0.5, 0.5, 1, 1, 0.95], chair * 85);
  output[chair * 85 + 5 + 56] = 0.95;
  const tile = { x: 1000, y: 500, w: 832, h: 832 }; // scale 0.5
  const found = decodeTile(output, tile);
  assert.equal(found.length, 1);
  assert.equal(found[0].label, 'aeroplane');
  assert.equal(tileScale(tile), 0.5);
  // centre in the tile: ((0.5+10)*8, (0.5+20)*8) = (84, 164); width 32, height 16; in photo pixels divide by scale.
  assert.ok(Math.abs(found[0].box.x - (1000 + (84 - 16) / 0.5)) < 1e-6);
  assert.ok(Math.abs(found[0].box.w - 64) < 1e-6);
  assert.ok(Math.abs(found[0].box.h - 32) < 1e-6);
});

test('overlapping tiles do not report one jet twice', () => {
  const a = { label: 'aeroplane', classId: 4, score: 0.8, box: { x: 100, y: 100, w: 50, h: 30 } };
  const b = { ...a, score: 0.6, box: { x: 104, y: 102, w: 50, h: 30 } };
  const c = { ...a, classId: 14, label: 'bird', box: { x: 400, y: 100, w: 50, h: 30 } };
  assert.deepEqual(mergeDetections([b, a, c]).map((d) => d.label), ['aeroplane', 'bird']);
});

test('a crisp picture reads as sharper than a blurred one, and a flat one reads as zero', () => {
  const size = 32;
  const make = (fill: (x: number, y: number) => number) => {
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) data.set([fill(x, y), fill(x, y), fill(x, y), 255], (y * size + x) * 4);
    return data;
  };
  const crisp = boxSharpness(make((x) => (x % 4 < 2 ? 40 : 220)), size, size);
  const soft = boxSharpness(make((x) => 130 + 90 * Math.sin(x / 5)), size, size);
  assert.ok(crisp > soft * 3, `${crisp} vs ${soft}`);
  assert.equal(boxSharpness(make(() => 100), size, size), 0);
});

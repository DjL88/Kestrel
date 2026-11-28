import assert from 'node:assert/strict';
import test from 'node:test';
import { applyHeal, clampHealSpot, findHealSources, hasHeal, validHeal, validHealSpot, type HealSpot } from './heal';
import { fullContext } from './masks';
import { isEmptyEdit, isNeutralEdit } from './photoEdits';
import { master16Blocker } from './master16';

/** A soft left-to-right gradient with a dark "dust" dot at (cx, cy). */
function picture(width: number, height: number, dust?: { cx: number; cy: number; r: number }) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const base = 80 + Math.round((x / width) * 100);
      const dusty = dust && Math.hypot(x + 0.5 - dust.cx, y + 0.5 - dust.cy) < dust.r;
      pixels[i] = dusty ? 20 : base; pixels[i + 1] = dusty ? 20 : base + 10; pixels[i + 2] = dusty ? 20 : base + 20; pixels[i + 3] = 255;
    }
  }
  return pixels;
}

const spot = (over: Partial<HealSpot> = {}): HealSpot => ({ id: 's1', x: 0.5, y: 0.5, sx: 0.5, sy: 0.25, r: 0.05, mode: 'heal', ...over });
const at = (pixels: Uint8ClampedArray, width: number, x: number, y: number) => Array.from(pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 4));

test('a spot is validated: ranges, modes, unique ids and the spot limit', () => {
  assert.equal(validHealSpot(spot()), true);
  assert.equal(validHealSpot(spot({ r: 0.5 })), false);
  assert.equal(validHealSpot(spot({ x: 1.2 })), false);
  assert.equal(validHealSpot({ ...spot(), mode: 'generate' }), false);
  assert.equal(validHealSpot(spot({ feather: 2 })), false);
  assert.equal(validHeal([spot(), spot()]), false, 'duplicate ids are refused');
  assert.equal(validHeal([spot(), spot({ id: 's2' })]), true);
  assert.equal(validHeal(Array.from({ length: 201 }, (_, i) => spot({ id: `s${i}` }))), false);
  assert.equal(hasHeal([spot({ hidden: true })]), false);
  assert.equal(hasHeal([spot()]), true);
});

test('healing removes a dust spot using nearby pixels and blends with the gradient', () => {
  const width = 200, height = 200;
  const clean = picture(width, height);
  const dusty = picture(width, height, { cx: 100, cy: 100, r: 5 });
  assert.deepEqual(at(dusty, width, 100, 100).slice(0, 3), [20, 20, 20]);
  applyHeal(dusty, width, height, 4, 255, [spot({ r: 0.04 })], fullContext(width, height));
  for (const [x, y] of [[100, 100], [97, 102], [103, 98]]) {
    const healed = at(dusty, width, x, y), expected = at(clean, width, x, y);
    for (let c = 0; c < 3; c += 1) assert.ok(Math.abs(healed[c] - expected[c]) <= 2, `pixel ${x},${y} channel ${c}: ${healed[c]} vs ${expected[c]}`);
    assert.equal(healed[3], 255, 'alpha is left alone');
  }
  // Far outside the spot nothing changes.
  assert.deepEqual(at(dusty, width, 10, 10), at(clean, width, 10, 10));
});

test('heal matches tone at the edges where clone copies exactly', () => {
  const width = 200, height = 200;
  // Copy from the darker left side onto the brighter right side.
  const cloned = picture(width, height);
  applyHeal(cloned, width, height, 4, 255, [spot({ x: 0.75, y: 0.5, sx: 0.25, sy: 0.5, r: 0.04, mode: 'clone', feather: 0 })], fullContext(width, height));
  const source = picture(width, height);
  assert.deepEqual(at(cloned, width, 150, 100), at(source, width, 50, 100), 'clone is an exact copy of the source pixel');
  const healed = picture(width, height);
  applyHeal(healed, width, height, 4, 255, [spot({ x: 0.75, y: 0.5, sx: 0.25, sy: 0.5, r: 0.04, mode: 'heal', feather: 0 })], fullContext(width, height));
  const original = picture(width, height);
  assert.ok(Math.abs(at(healed, width, 150, 100)[0] - at(original, width, 150, 100)[0]) <= 3, 'heal shifts the copy to the surrounding tone');
});

test('a hidden spot, and an empty list, change nothing', () => {
  const width = 64, height = 64;
  const pixels = picture(width, height, { cx: 32, cy: 32, r: 3 });
  const before = pixels.slice();
  applyHeal(pixels, width, height, 4, 255, [spot({ hidden: true })], fullContext(width, height));
  applyHeal(pixels, width, height, 4, 255, [], fullContext(width, height));
  assert.deepEqual(pixels, before);
});

test('16-bit RGB pictures heal at full precision', () => {
  const width = 100, height = 100;
  const data = new Uint16Array(width * height * 3);
  for (let i = 0; i < width * height; i += 1) { data[i * 3] = 30000; data[i * 3 + 1] = 31000; data[i * 3 + 2] = 32000; }
  for (let y = 48; y < 53; y += 1) for (let x = 48; x < 53; x += 1) data[(y * width + x) * 3] = 1000;
  applyHeal(data, width, height, 3, 65535, [spot({ r: 0.05 })], fullContext(width, height), 100);
  assert.equal(data[(50 * width + 50) * 3], 30000);
  assert.equal(data[(50 * width + 50) * 3 + 2], 32000);
});

test('the spot lands in the same place on a zoomed part of the photo', () => {
  // The whole photo is 200 x 200; the canvas shows its right half at full size.
  const width = 200, height = 200;
  const whole = picture(width, height, { cx: 150, cy: 100, r: 4 });
  const half = new Uint8ClampedArray(100 * 200 * 4);
  for (let y = 0; y < 200; y += 1) half.set(whole.slice((y * 200 + 100) * 4, (y * 200 + 200) * 4), y * 100 * 4);
  const heal = [spot({ x: 0.75, y: 0.5, sx: 0.75, sy: 0.3, r: 0.04 })];
  applyHeal(whole, 200, 200, 4, 255, heal, fullContext(200, 200));
  applyHeal(half, 100, 200, 4, 255, heal, { aspect: 1, view: { x: 0.5, y: 0, w: 0.5, h: 1 } }, 200);
  assert.deepEqual(at(half, 100, 50, 100), at(whole, 200, 150, 100));
});

test('sources are found nearby, on the picture, and avoid copying other dust', () => {
  const width = 300, height = 300;
  const pixels = picture(width, height, { cx: 150, cy: 150, r: 5 });
  // A second dust spot right above, where a careless search would copy from.
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (Math.hypot(x - 150, y - 105) < 9) { const i = (y * width + x) * 4; pixels[i] = pixels[i + 1] = pixels[i + 2] = 10; }
  }
  const sources = findHealSources(pixels, width, height, 4, 0.5, 0.5, 0.02);
  assert.ok(sources.length >= 3);
  for (const source of sources) {
    const distance = Math.hypot((source.sx - 0.5) * width, (source.sy - 0.5) * height);
    assert.ok(distance >= 0.02 * 300 * 2, 'never overlaps the spot');
    assert.ok(distance <= 0.02 * 300 * 5, 'stays nearby');
  }
  const best = sources[0];
  assert.ok(Math.hypot(best.sx * width - 150, best.sy * height - 105) > 15, 'the best source is not the other dust spot');
  assert.ok(Math.abs(best.sx * width - 150) < Math.abs(best.sy * height - 150), 'a gradient running left to right is best matched straight up or down, in the same tone');
});

test('a spot near the edge never offers a source off the picture', () => {
  const pixels = picture(100, 100);
  for (const source of findHealSources(pixels, 100, 100, 4, 0.05, 0.05, 0.03)) {
    assert.ok(source.sx > 0 && source.sx < 1 && source.sy > 0 && source.sy < 1);
  }
});

test('spot numbers are kept in range', () => {
  const clamped = clampHealSpot(spot({ x: -0.2, sy: 1.4, r: 0.9, feather: 3 }));
  assert.equal(clamped.x, 0);
  assert.equal(clamped.sy, 1);
  assert.equal(clamped.r, 0.15);
  assert.equal(clamped.feather, 1);
});

test('a photo with healing is an edit, and the 16-bit export carries it', () => {
  const edit = { exposure: 0, warmth: 0, colour: 0, heal: [spot()] };
  assert.equal(isNeutralEdit(edit), false);
  assert.equal(isEmptyEdit({ exposure: 0, warmth: 0, colour: 0, heal: [spot({ hidden: true })] }), false, 'a hidden spot is still kept');
  assert.equal(master16Blocker(edit, undefined), null);
  assert.match(master16Blocker({ ...edit, heal: [spot({ r: 9 })] }, undefined) ?? '', /spot healing is invalid/);
});

test('findSpotCandidates offers isolated specks, not smooth gradients or long edges', async () => {
  const { findSpotCandidates } = await import('./healCandidates');
  const width = 300, height = 200;
  const clean = picture(width, height);
  assert.deepEqual(findSpotCandidates(clean, width, height, 4), []);
  const dusty = picture(width, height, { cx: 150, cy: 100, r: 3 });
  const found = findSpotCandidates(dusty, width, height, 4);
  assert.equal(found.length, 1);
  assert.ok(Math.abs(found[0].x - 0.5) < 0.01 && Math.abs(found[0].y - 0.5) < 0.01);
  assert.equal(found[0].tone, 'darker');
  // A hard vertical edge is not a speck.
  const edgeShot = picture(width, height);
  for (let y = 0; y < height; y += 1) for (let x = 150; x < width; x += 1) { const i = (y * width + x) * 4; edgeShot[i] = edgeShot[i + 1] = edgeShot[i + 2] = 250; }
  assert.deepEqual(findSpotCandidates(edgeShot, width, height, 4), []);
});

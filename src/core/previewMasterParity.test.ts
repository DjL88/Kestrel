import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPhotoEdit, blendEncoded8, DEFAULT_EDIT, type PhotoEdit } from './photoEdits';
import { blendSrgb16 } from './linearRgb16';
import { editRgb16, type Rgb16Image } from './master16';
import { applyMasks, fullContext } from './masks';
import { createMask, type Mask } from './maskTypes';

/**
 * Product rule: the editor preview (8-bit) matches the exported 16-bit master.
 * Both paths render the SAME recipe from 8-bit-exact source values (v * 257), so any difference is the maths
 * convention, not input precision. The 8-bit preview rounds once per stage, the master never does.
 *
 * Documented tolerances, in 8-bit levels (1 level = 257 sixteen-bit counts):
 *  - global tone:  0.51  (one preview rounding: 0.5; measured worst 0.498)
 *  - masked tone:  1.01  (two preview roundings: the adjusted copy, then the blend; measured worst 0.903)
 * A change of blend convention (e.g. linear-light mixing in the master only) moves feather rings by 6 to 12 levels
 * and fails this test. If you change it, change applyMasks (preview) in the same PR.
 */
const GLOBAL_TOLERANCE = 0.51;
const MASKED_TOLERANCE = 1.01;

function ramps(width: number, height: number): { eight: Uint8ClampedArray; sixteen: Rgb16Image } {
  const eight = new Uint8ClampedArray(width * height * 4);
  const data = new Uint16Array(width * height * 3);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const p = y * width + x;
    const v = Math.round((x / (width - 1)) * 255);
    // Three channels offset so colour edits, not just luminance, are exercised.
    const rgb = [v, Math.min(255, Math.round(v * 0.8) + 12), Math.max(0, 255 - v) ];
    eight.set([rgb[0], rgb[1], rgb[2], 255], p * 4);
    data.set(rgb.map((c) => c * 257), p * 3);
  }
  return { eight, sixteen: { width, height, data } };
}

function worstDifference(eight: Uint8ClampedArray, sixteen: Rgb16Image): { worst: number; at: number } {
  let worst = 0, at = -1;
  for (let p = 0; p < sixteen.width * sixteen.height; p += 1) for (let c = 0; c < 3; c += 1) {
    const d = Math.abs(sixteen.data[p * 3 + c] / 257 - eight[p * 4 + c]);
    if (d > worst) { worst = d; at = p * 3 + c; }
  }
  return { worst, at };
}

const GLOBAL_EDITS: Record<string, PhotoEdit> = {
  exposure: { ...DEFAULT_EDIT, exposure: 0.9 },
  shadowLift: { ...DEFAULT_EDIT, exposure: 1, shadows: 2 },
  full: { ...DEFAULT_EDIT, exposure: 0.6, warmth: 0.3, colour: 0.4, contrast: 0.5, shadows: 1, highlights: -1, whites: 0.5, blacks: 0.4, vibrance: 0.6, brightness: 0.5 },
};

for (const [name, edit] of Object.entries(GLOBAL_EDITS)) {
  test(`preview and master agree on a ramp: global ${name}`, () => {
    const { eight, sixteen } = ramps(256, 1);
    applyPhotoEdit(eight, edit);
    editRgb16(sixteen, edit);
    const { worst, at } = worstDifference(eight, sixteen);
    assert.ok(worst <= GLOBAL_TOLERANCE, `worst ${worst.toFixed(3)} levels at sample ${at}`);
  });
}

const MASKS: Record<string, Mask> = {
  linearFeather: { ...createMask('linear', 'sky'), kind: 'linear', x1: 0.2, y1: 0.5, x2: 0.8, y2: 0.5, feather: 1, edit: { exposure: 0.9, shadows: 0.3 } } as Mask,
  radialFeather: { ...createMask('radial', 'bird'), kind: 'radial', cx: 0.5, cy: 0.5, rx: 0.4, ry: 0.4, feather: 0.7, edit: { exposure: -0.8, colour: 0.4 } } as Mask,
};

for (const [name, mask] of Object.entries(MASKS)) {
  test(`preview and master agree on a masked ramp: ${name}`, () => {
    const width = 256, height = 8;
    const { eight, sixteen } = ramps(width, height);
    applyMasks(eight, width, height, [mask], fullContext(width, height));
    editRgb16(sixteen, { ...DEFAULT_EDIT, masks: [mask] });
    const { worst, at } = worstDifference(eight, sixteen);
    assert.ok(worst <= MASKED_TOLERANCE, `worst ${worst.toFixed(3)} levels at sample ${at}`);
    // The test must not pass vacuously: the mask really changed partially covered pixels.
    assert.ok(sixteen.data.some((v, i) => v !== ramps(width, height).sixteen.data[i]), 'mask changed the ramp');
  });
}

test('feathered edges blend in linear light: no dark fringe, and the 8-bit and 16-bit blends agree', () => {
  // Dark source, bright adjusted. An encoded-space mix at half coverage gives about 133 (a dark ring); linear light gives about 188.
  const mid = blendEncoded8(10, 255, 0.5);
  assert.ok(mid > 170 && mid < 200, `half mix of 10 and 255 is ${mid}, not the encoded midpoint 133`);
  for (let a = 0; a <= 1; a += 0.05) for (const [s, t] of [[10, 255], [40, 200], [128, 130], [0, 255]]) {
    const eight = blendEncoded8(s, t, a), sixteen = blendSrgb16(s * 257, t * 257, a) / 257;
    assert.ok(Math.abs(eight - sixteen) <= 0.51, `alpha ${a.toFixed(2)} ${s}->${t}: ${eight} vs ${sixteen.toFixed(2)}`);
  }
  assert.equal(blendEncoded8(10, 255, 0), 10);
  assert.equal(blendEncoded8(10, 255, 1), 255);
});

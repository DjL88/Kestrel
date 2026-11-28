import assert from 'node:assert/strict';
import test from 'node:test';
import { DENOISE_ZONES, hasDenoiseZones, strengthAt, validDenoiseZones, zoneWeights } from './denoiseZones';
import { denoiseLuminance } from './luminanceDenoise';
import { applyNoiseReduction, hasNoiseReduction } from './noiseReduction';
import { DEFAULT_EDIT, isNeutralEdit } from './photoEdits';
import { applyRecipePatch, editToRecipe } from '../v2/engineClient/recipeMap';

test('zone weights add to 1 everywhere and never step (smooth, no banding)', () => {
  let last = zoneWeights(0) as number[];
  last = [...last];
  for (let b = 0; b <= 1.0001; b += 0.001) {
    const w = [...zoneWeights(b)];
    assert.ok(Math.abs(w.reduce((a, c) => a + c, 0) - 1) < 1e-9, `sum at ${b}`);
    assert.ok(w.every((x) => x >= 0 && x <= 1));
    last.forEach((x, i) => assert.ok(Math.abs(x - w[i]) < 0.02, `step in zone ${i} at ${b}`));
    last = w;
  }
});

test('each zone owns its own brightness range', () => {
  const at = (b: number) => [...zoneWeights(b)];
  assert.equal(at(0.02)[0], 1); assert.equal(at(0.25)[1], 1); assert.equal(at(0.5)[2], 1); assert.equal(at(0.75)[3], 1); assert.equal(at(0.98)[4], 1);
});

test('strength is bounded 0 to 2 and equals the global one without zones', () => {
  assert.equal(strengthAt(0.8, [0, 0, 0, 0, 0], 0.4), 0.8);
  assert.equal(strengthAt(1.5, [2, 2, 2, 2, 2], 0.3), 2);
  assert.ok(strengthAt(0, [1, 0, 0, 0, 0], 0.5) < 1e-9);
});

const W = 120, H = 40;
function noisyRamp(): Uint8ClampedArray {
  const d = new Uint8ClampedArray(W * H * 4);
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 - 0.5; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const base = 10 + (x / (W - 1)) * 235;
    const v = Math.max(0, Math.min(255, base + rnd() * 14));
    d.set([v, v, v, 255], (y * W + x) * 4);
  }
  return d;
}
const roughness = (px: Uint8ClampedArray, x0: number, x1: number) => {
  let sum = 0, n = 0;
  for (let y = 0; y < H; y++) for (let x = x0; x < x1 - 1; x++) { sum += Math.abs(px[(y * W + x) * 4] - px[(y * W + x + 1) * 4]); n++; }
  return sum / n;
};

test('zones off (absent or zero) is exactly the previous output', () => {
  const a = noisyRamp(), b = noisyRamp(), c = noisyRamp();
  denoiseLuminance(a, W, H, 0.5);
  denoiseLuminance(b, W, H, 0.5, undefined, {});
  denoiseLuminance(c, W, H, 0.5, undefined, { shadows: 0, whites: 0 });
  assert.deepEqual(a, b); assert.deepEqual(a, c);
});

test('Shadows zone smooths the dark end far more than the bright end, with no seam between', () => {
  const plain = noisyRamp();
  const zoned = noisyRamp();
  denoiseLuminance(zoned, W, H, 0, undefined, { shadows: 2, blacks: 2 });
  assert.ok(roughness(zoned, 0, 30) < roughness(plain, 0, 30) * 0.8, 'dark end is smoother');
  assert.ok(Math.abs(roughness(zoned, 90, W) - roughness(plain, 90, W)) < 0.5, 'bright end is left as it was');
  // No banding: the roughness changes gradually along the ramp, never jumping between neighbouring 10-column bands.
  const profile: number[] = [];
  for (let x = 0; x + 10 <= W; x += 10) profile.push(roughness(zoned, x, x + 10));
  for (let i = 1; i < profile.length; i++) assert.ok(Math.abs(profile[i] - profile[i - 1]) < 2.5, `seam between bands ${i - 1} and ${i}: ${profile.map((p) => p.toFixed(1))}`);
});

test('the zones take part in the recipe: neutral check, pipeline entry point and the sliders', () => {
  const edit = { ...DEFAULT_EDIT, denoiseZones: { shadows: 1 } };
  assert.equal(isNeutralEdit(edit), false);
  assert.equal(hasNoiseReduction(edit), true);
  const out = applyNoiseReduction(noisyRamp(), W, H, edit);
  assert.notDeepEqual(out, noisyRamp());
  const recipe = editToRecipe(edit);
  assert.deepEqual(recipe.denoiseZones, { shadows: 50 });
  assert.deepEqual(applyRecipePatch(DEFAULT_EDIT, { denoiseZones: { shadows: 50, whites: 0 } }).edit.denoiseZones, { shadows: 1 });
  assert.equal(applyRecipePatch(edit, { denoiseZones: {} }).edit.denoiseZones, undefined);
  assert.equal(editToRecipe(DEFAULT_EDIT).denoiseZones, undefined);
});

test('stored zones are validated', () => {
  assert.equal(validDenoiseZones({ shadows: 1, whites: 0.5 }), true);
  assert.equal(validDenoiseZones({ shadows: 3 }), false);
  assert.equal(validDenoiseZones({ nope: 1 }), false);
  assert.equal(validDenoiseZones(null), false);
  assert.equal(hasDenoiseZones({ mids: 0 }), false);
  assert.deepEqual([...DENOISE_ZONES], ['blacks', 'shadows', 'mids', 'highlights', 'whites']);
});

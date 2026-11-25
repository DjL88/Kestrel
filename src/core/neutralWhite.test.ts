import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { balancedSample, estimateIlluminant, neutralBalance, samplePatch, type Rgb } from './neutralWhite';
import { applyRecipePatch, editToRecipe } from '../v2/engineClient/recipeMap';

const spread = ([r, g, b]: Rgb) => (Math.max(r, g, b) - Math.min(r, g, b)) / ((r + g + b) / 3);

function fill(width: number, height: number, rgb: [number, number, number]) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) pixels.set([...rgb, 255], i * 4);
  return pixels;
}

describe('neutral white balance', () => {
  it('makes a warm grey neutral with Temperature and Tint (JPEG, no as-shot estimate)', () => {
    const sample: Rgb = [0.22, 0.2, 0.17];
    const balance = neutralBalance(sample);
    assert.equal(balance.whiteBalance, undefined);
    assert.ok(balance.warmth < 0); // cooler
    assert.equal(balance.limited, false);
    assert.ok(spread(balancedSample(sample, balance)) < 0.002);
  });

  it('makes a green cast neutral with Tint towards magenta', () => {
    const sample: Rgb = [0.18, 0.23, 0.18];
    const balance = neutralBalance(sample);
    assert.ok(balance.tint > 0);
    assert.ok(Math.abs(balance.warmth) < 1e-3);
    assert.ok(spread(balancedSample(sample, balance)) < 0.002);
  });

  it('moves Kelvin, not Temperature, for a RAW with an as-shot estimate', () => {
    const sample: Rgb = [0.15, 0.2, 0.26]; // blue cast
    const balance = neutralBalance(sample, 5200);
    assert.equal(balance.warmth, 0);
    assert.equal(balance.whiteBalance?.asShotK, 5200);
    assert.ok(balance.whiteBalance!.kelvin > 5200); // warmer target
    assert.ok(spread(balancedSample(sample, balance)) < 0.01);
  });

  it('leaves an already neutral grey at as shot', () => {
    const balance = neutralBalance([0.2, 0.2, 0.2], 5600);
    assert.deepEqual(balance, { warmth: 0, tint: 0, limited: false });
  });

  it('says when a cast is beyond the slider range instead of pretending', () => {
    const balance = neutralBalance([0.5, 0.2, 0.02]);
    assert.equal(balance.limited, true);
    assert.equal(balance.warmth, -2);
  });

  it('survives the V2 recipe round trip, so preview and export read the same numbers', () => {
    const sample: Rgb = [0.22, 0.2, 0.16];
    const balance = neutralBalance(sample);
    const patch = { temperature: balance.warmth * 50, tint: balance.tint * 50 };
    const { edit } = applyRecipePatch(undefined, patch);
    assert.ok(Math.abs(edit.warmth - balance.warmth) < 1e-4);
    assert.ok(Math.abs((edit.tint ?? 0) - balance.tint) < 1e-4);
    assert.ok(Math.abs(editToRecipe(edit).tint - patch.tint) < 1e-2);
    assert.ok(spread(balancedSample(sample, { warmth: edit.warmth, tint: edit.tint ?? 0 })) < 0.003);
  });

  it('samples a patch in linear light, skipping clipped pixels, and refuses black or blown-out spots', () => {
    const pixels = fill(10, 10, [128, 128, 128]);
    pixels.set([255, 255, 255, 255], (5 * 10 + 5) * 4);
    const mean = samplePatch(pixels, 10, 10, 5, 5, 1)!;
    assert.ok(Math.abs(mean[0] - 0.2158) < 1e-3);
    assert.equal(samplePatch(fill(4, 4, [255, 255, 255]), 4, 4, 2, 2, 1), null);
    assert.equal(samplePatch(fill(4, 4, [2, 2, 2]), 4, 4, 2, 2, 1), null);
    assert.equal(samplePatch(pixels, 10, 10, -1, 5, 1), null);
  });

  it('estimates a warm light from the whole picture, and declines when nothing is readable', () => {
    const warm = estimateIlluminant(fill(20, 20, [175, 170, 160]), 20, 20)!;
    assert.ok(warm[0] > warm[2]);
    assert.ok(spread(balancedSample(warm, neutralBalance(warm))) < 0.002);
    assert.equal(estimateIlluminant(fill(20, 20, [255, 255, 255]), 20, 20), null);
  });
});

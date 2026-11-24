import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateNoiseSigma, luminanceStrengthFor, VISIBLE_NOISE_SIGMA } from './noiseEstimate';

/** Seeded Gaussian noise (Box-Muller) on a picture made by `base`. */
function picture(width: number, height: number, sigma: number, base: (x: number, y: number) => number, seed = 7): Uint8ClampedArray {
  let state = seed;
  const rand = () => { state = (state * 1664525 + 1013904223) >>> 0; return (state + 0.5) / 4294967296; };
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const n = sigma * Math.sqrt(-2 * Math.log(rand())) * Math.cos(2 * Math.PI * rand());
    const v = base(x, y) + n;
    const i = (y * width + x) * 4;
    out[i] = out[i + 1] = out[i + 2] = v; out[i + 3] = 255;
  }
  return out;
}

const flat = () => 120;
const gradient = (x: number) => 60 + x * 0.4;

test('known noise levels are measured within 20% on flat and smoothly graded pictures', () => {
  for (const sigma of [3, 6, 10]) {
    for (const base of [flat, gradient]) {
      const got = estimateNoiseSigma(picture(256, 192, sigma, base), 256, 192)!;
      assert.ok(Math.abs(got - sigma) / sigma < 0.2, `sigma ${sigma}: measured ${got.toFixed(2)}`);
    }
  }
});

test('a clean picture reads as below visible noise and asks for no luminance denoise', () => {
  const sigma = estimateNoiseSigma(picture(256, 192, 0, gradient), 256, 192)!;
  assert.ok(sigma < VISIBLE_NOISE_SIGMA);
  assert.equal(luminanceStrengthFor(sigma), 0);
});

test('fine texture in part of the frame does not inflate the estimate from the flat background', () => {
  // A clean frame whose left third is busy texture (like plumage) and the rest is clean sky.
  const textured = picture(240, 192, 0, (x, y) => (x < 80 ? 120 + 60 * Math.sin(x * 1.7) * Math.cos(y * 1.3) : 160));
  const sigma = estimateNoiseSigma(textured, 240, 192)!;
  assert.ok(sigma < VISIBLE_NOISE_SIGMA, `texture read as noise: ${sigma.toFixed(2)}`);
});

test('strength grows with noise, is capped, and is never asked for on missing evidence', () => {
  assert.equal(luminanceStrengthFor(null), 0);
  assert.equal(luminanceStrengthFor(Number.NaN), 0);
  const low = luminanceStrengthFor(2), high = luminanceStrengthFor(8);
  assert.ok(low > 0 && high > low);
  assert.equal(luminanceStrengthFor(100), 1.6);
  assert.equal(estimateNoiseSigma(new Uint8ClampedArray(16), 2, 2), null);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { liftForNoise, anywayLuminanceStrength, ANYWAY_LUMINANCE_STRENGTH, estimateNoiseSigma, luminanceStrengthFor, measureBackgroundNoise, MIN_BACKGROUND_BLOCKS, VISIBLE_NOISE_SIGMA } from './noiseEstimate';

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

test('noisy shadows are found even when a clean bright area fills much of the frame', () => {
  // Dave, 27 Nov (DJL3766): visibly noisy, yet "no visible noise". The top half is clean bright sky, the bottom half
  // dark ground with RAW-like shadow noise; the single 20th percentile over all blocks read only the sky.
  const sky = picture(256, 256, 0.4, () => 200, 11);
  const ground = picture(256, 256, 5, () => 50, 12);
  const both = new Uint8ClampedArray(256 * 256 * 4);
  both.set(sky.subarray(0, 256 * 128 * 4), 0);
  both.set(ground.subarray(256 * 128 * 4), 256 * 128 * 4);
  const sigma = estimateNoiseSigma(both, 256, 256)!;
  assert.ok(Math.abs(sigma - 5) / 5 < 0.25, `shadow noise 5, measured ${sigma.toFixed(2)}`);
  assert.ok(luminanceStrengthFor(sigma) > 0);
});

test('a small noisy corner does not decide on its own', () => {
  // Under a tenth of the frame dark and noisy, the rest clean: too little to call the photo noisy.
  const clean = picture(320, 320, 0.3, () => 150, 21);
  const corner = picture(320, 320, 6, () => 40, 22);
  for (let y = 0; y < 80; y += 1) for (let x = 0; x < 80; x += 1) {
    const i = (y * 320 + x) * 4;
    clean[i] = clean[i + 1] = clean[i + 2] = corner[i];
  }
  assert.ok(estimateNoiseSigma(clean, 320, 320)! < VISIBLE_NOISE_SIGMA);
});

test('strength grows with noise, is capped, and is never asked for on missing evidence', () => {
  assert.equal(luminanceStrengthFor(null), 0);
  assert.equal(luminanceStrengthFor(Number.NaN), 0);
  const low = luminanceStrengthFor(2), high = luminanceStrengthFor(8);
  assert.ok(low > 0 && high > low);
  assert.equal(luminanceStrengthFor(100), 1.6);
  assert.equal(estimateNoiseSigma(new Uint8ClampedArray(16), 2, 2), null);
});

test('a high ISO still gets a gentle denoise when the estimate reads clean, and a low ISO does not', () => {
  assert.equal(luminanceStrengthFor(0.3, 100), 0);
  assert.equal(luminanceStrengthFor(0.3), 0);
  assert.ok(luminanceStrengthFor(0.3, 3200) > 0);
  assert.equal(luminanceStrengthFor(null, 6400), 0, 'no evidence is still no denoise');
});

/** A centred "subject" box covering `share` of each side, with its own noise, on a background with its own. */
function withSubject(size: number, share: number, subjectSigma: number, backgroundSigma: number, subjectBase: (x: number, y: number) => number = () => 120) {
  const background = picture(size, size, backgroundSigma, () => 120, 31);
  const subject = picture(size, size, subjectSigma, subjectBase, 32);
  const exclude = new Uint8Array(size * size);
  const lo = Math.floor(size * (1 - share) / 2), hi = Math.ceil(size * (1 + share) / 2);
  for (let y = lo; y < hi; y += 1) for (let x = lo; x < hi; x += 1) {
    const i = y * size + x;
    exclude[i] = 1;
    for (let c = 0; c < 3; c += 1) background[i * 4 + c] = subject[i * 4 + c];
  }
  return { rgba: background, exclude };
}

test('the background sets the reading when a clean, sharp subject fills most of the frame', () => {
  // Subject 80% of each side (64% of the area), clean; noisy background around it. Without the mask the clean subject's
  // blocks are the flattest and the photo reads as clean.
  const { rgba, exclude } = withSubject(512, 0.8, 0.3, 6);
  const blind = measureBackgroundNoise(rgba, 512, 512);
  assert.ok(blind.sigma! < VISIBLE_NOISE_SIGMA, `without the subject mask it reads ${blind.sigma!.toFixed(2)}`);
  const masked = measureBackgroundNoise(rgba, 512, 512, exclude);
  assert.equal(masked.subjectLeftOut, true);
  assert.ok(masked.subjectBlocks > 0);
  assert.ok(Math.abs(masked.sigma! - 6) / 6 < 0.25, `background noise 6, measured ${masked.sigma!.toFixed(2)}`);
  assert.ok(luminanceStrengthFor(masked.sigma) > 0);
});

test('a busy textured subject is left out and does not inflate a clean background', () => {
  const { rgba, exclude } = withSubject(512, 0.5, 0, 0.3, (x, y) => 120 + 70 * Math.sin(x * 1.9) * Math.cos(y * 1.7));
  const masked = measureBackgroundNoise(rgba, 512, 512, exclude);
  assert.equal(masked.subjectLeftOut, true);
  assert.ok(masked.sigma! < VISIBLE_NOISE_SIGMA, `clean background read as ${masked.sigma!.toFixed(2)}`);
});

test('a clean frame stays clean with the subject left out, and the same reading comes with no mask', () => {
  const { rgba, exclude } = withSubject(384, 0.4, 0.2, 0.2);
  assert.ok(measureBackgroundNoise(rgba, 384, 384, exclude).sigma! < VISIBLE_NOISE_SIGMA);
  assert.equal(measureBackgroundNoise(rgba, 384, 384).sigma, estimateNoiseSigma(rgba, 384, 384));
});

test('a subject that fills nearly the whole frame falls back to reading everything, and says so', () => {
  const { rgba, exclude } = withSubject(256, 0.98, 5, 5);
  const result = measureBackgroundNoise(rgba, 256, 256, exclude);
  assert.equal(result.subjectLeftOut, false);
  assert.ok(result.blocks >= MIN_BACKGROUND_BLOCKS, 'the fallback reads the blocks of the whole frame');
  assert.ok(Math.abs(result.sigma! - 5) / 5 < 0.25);
});

test('a mask of the wrong size is ignored rather than trusted', () => {
  const { rgba } = withSubject(256, 0.5, 0.3, 6);
  const result = measureBackgroundNoise(rgba, 256, 256, new Uint8Array(10).fill(1));
  assert.equal(result.subjectLeftOut, false);
  assert.ok(result.sigma! > 0);
});

test('"Denoise anyway" is gentle, never below the default, and never stronger than the measured need', () => {
  assert.equal(anywayLuminanceStrength(0.4, 100), ANYWAY_LUMINANCE_STRENGTH);
  assert.equal(anywayLuminanceStrength(null), ANYWAY_LUMINANCE_STRENGTH);
  assert.equal(anywayLuminanceStrength(8), luminanceStrengthFor(8));
  assert.ok(ANYWAY_LUMINANCE_STRENGTH <= 0.5);
});

// Owner's dark kingfisher (28 Nov 2026 beta): denoise said "no visible noise" because the noise was read on the dark,
// unlifted pixels, yet after a +2 EV lift the grain is plain. Noise is judged at the exposure the photo is shown at.
test('a dark frame reads clean as shot but noisy once lifted by two stops', () => {
  const dark = picture(256, 256, 0.9, (x) => 22 + (x % 64) / 8);
  const asShot = estimateNoiseSigma(dark, 256, 256) as number;
  const lifted = estimateNoiseSigma(liftForNoise(dark, 2), 256, 256) as number;
  assert.ok(asShot < VISIBLE_NOISE_SIGMA, `as shot ${asShot}`);
  assert.ok(lifted > VISIBLE_NOISE_SIGMA, `lifted ${lifted}`);
  assert.ok(luminanceStrengthFor(lifted) > 0 && luminanceStrengthFor(asShot) === 0);
});

test('lifting for the noise reading never touches the original pixels, and only ever brightens', () => {
  const dark = picture(64, 64, 1, () => 30);
  const copy = Uint8ClampedArray.from(dark);
  const lifted = liftForNoise(dark, 1);
  assert.deepEqual(dark, copy);
  assert.ok(lifted[0] > dark[0]);
  assert.equal(liftForNoise(dark, 0), dark, 'no lift: the same pixels');
  assert.equal(liftForNoise(dark, -1), dark, 'a darkening is never applied');
});

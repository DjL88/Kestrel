import test from 'node:test';
import assert from 'node:assert/strict';
import { focalPxFrom35mm, largestRectangle, stitchPanorama, type PanoSource, type PanoSuccess } from './panorama.ts';
import { panoramaRecipe, readPanoramaRecipe } from './panoramaRecipe.ts';

// Synthetic overlaps: one seeded texture laid on a cylinder, photographed by a pinhole camera turned to several yaw
// angles. The true panorama is that texture, so every stitched pixel can be checked against the truth.

/** Seam error bound: mean absolute error in the overlaps, as a share of full scale (0..1). */
const SEAM_BOUND = 0.01;
/** Whole-picture error bound, same units. */
const PICTURE_BOUND = 0.01;

const TW = 1400, TH = 360;

function prng(seed: number) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
}

/** RGB texture 0..1: multi-octave value noise plus rectangles, lightly blurred so resampling is fair. */
function texture(seed: number): Float32Array {
  const rand = prng(seed);
  const t = new Float32Array(TW * TH * 3);
  for (const cellSize of [48, 24, 12, 6]) {
    const gw = Math.ceil(TW / cellSize) + 2, gh = Math.ceil(TH / cellSize) + 2;
    const grid = Array.from({ length: gw * gh * 3 }, () => rand());
    const amp = cellSize / 90;
    for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
      const gx = x / cellSize, gy = y / cellSize, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
      for (let c = 0; c < 3; c++) {
        const g = (a: number, b: number) => grid[((iy + b) * gw + ix + a) * 3 + c];
        const v = (g(0, 0) * (1 - fx) + g(1, 0) * fx) * (1 - fy) + (g(0, 1) * (1 - fx) + g(1, 1) * fx) * fy;
        t[(y * TW + x) * 3 + c] += v * amp;
      }
    }
  }
  for (let r = 0; r < 500; r++) {
    const x0 = Math.floor(rand() * TW), y0 = Math.floor(rand() * TH), w = 3 + Math.floor(rand() * 14), h = 3 + Math.floor(rand() * 14);
    const col = [rand(), rand(), rand()];
    for (let y = y0; y < Math.min(TH, y0 + h); y++) for (let x = x0; x < Math.min(TW, x0 + w); x++) for (let c = 0; c < 3; c++) t[(y * TW + x) * 3 + c] = t[(y * TW + x) * 3 + c] * 0.3 + col[c] * 0.7;
  }
  let lo = Infinity, hi = -Infinity;
  for (const v of t) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const out = new Float32Array(t.length);
  for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) for (let c = 0; c < 3; c++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = Math.min(TH - 1, Math.max(0, y + dy)), xx = Math.min(TW - 1, Math.max(0, x + dx));
      s += t[(yy * TW + xx) * 3 + c]; n++;
    }
    out[(y * TW + x) * 3 + c] = 0.08 + 0.84 * ((s / n) - lo) / (hi - lo);
  }
  return out;
}

function tex(t: Float32Array, x: number, y: number, c: number): number {
  const xi = Math.max(0, Math.min(TW - 2, Math.floor(x))), yi = Math.max(0, Math.min(TH - 2, Math.floor(y)));
  const fx = Math.min(1, Math.max(0, x - xi)), fy = Math.min(1, Math.max(0, y - yi));
  const g = (a: number, b: number) => t[((yi + b) * TW + xi + a) * 3 + c];
  return (g(0, 0) * (1 - fx) + g(1, 0) * fx) * (1 - fy) + (g(0, 1) * (1 - fx) + g(1, 1) * fx) * fy;
}

const FW = 360, FH = 240, F = 300;

/** One 8-bit RGBA frame of the cylinder texture at yaw `yaw` (radians), focal F, optional exposure gain. */
function frame(t: Float32Array, yaw: number, gain = 1): PanoSource {
  const data = new Uint8ClampedArray(FW * FH * 4);
  const cx = (FW - 1) / 2, cy = (FH - 1) / 2;
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    const X = x - cx, Y = y - cy;
    const theta = Math.atan2(X, F) + yaw, h = Y / Math.hypot(X, F);
    const tx = theta * F + TW / 2, ty = h * F + TH / 2;
    const p = (y * FW + x) * 4;
    for (let c = 0; c < 3; c++) data[p + c] = Math.round(255 * Math.min(1, tex(t, tx, ty, c) * gain));
    data[p + 3] = 255;
  }
  return { width: FW, height: FH, data, bits: 8 };
}

const STEP = 0.6; // radians between frames: about 45% overlap at this focal length
const yaws = (n: number) => Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * STEP);

/** Error against the truth: whole picture, and in the columns where two frames overlap. */
function errors(t: Float32Array, result: PanoSuccess, frameYaws: number[]) {
  const refYaw = frameYaws[result.referenceIndex];
  const half = Math.atan2((FW - 1) / 2, F);
  let all = 0, allN = 0, seam = 0, seamN = 0;
  for (let y = 0; y < result.height; y++) for (let x = 0; x < result.width; x++) {
    const u = result.origin.u + x, v = result.origin.v + y;
    const theta = u / F + refYaw;
    const covering = frameYaws.filter((yaw) => Math.abs(theta - yaw) < half).length;
    const tx = u + refYaw * F + TW / 2, ty = v + TH / 2;
    let e = 0;
    for (let c = 0; c < 3; c++) e += Math.abs(result.data[(y * result.width + x) * 3 + c] / 65535 - tex(t, tx, ty, c));
    e /= 3;
    all += e; allN++;
    if (covering >= 2) { seam += e; seamN++; }
  }
  return { picture: all / allN, seam: seam / Math.max(1, seamN), seamPixels: seamN };
}

const scene = texture(7);

test('four overlapping frames stitch into one panorama within the seam error bound (camera focal length)', async () => {
  const ys = yaws(4);
  const result = await stitchPanorama(ys.map((y) => frame(scene, y)), { focalPx: F });
  assert.ok(result.ok, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.focalSource, 'camera');
  assert.equal(result.data.length, result.width * result.height * 3);
  assert.ok(result.width > FW * 2.2, `width ${result.width}`);
  assert.ok(result.height > FH * 0.8 && result.height <= FH + 4, `height ${result.height}`);
  // Placement: each frame sits STEP·F further along the cylinder than the one before.
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(result.placements[i].du - (i - result.referenceIndex) * STEP * F) < 1.5, `frame ${i} du ${result.placements[i].du}`);
  const e = errors(scene, result, ys);
  assert.ok(e.seamPixels > 10000);
  assert.ok(e.seam < SEAM_BOUND, `seam error ${e.seam}`);
  assert.ok(e.picture < PICTURE_BOUND, `picture error ${e.picture}`);
  assert.ok(result.seamMismatch < SEAM_BOUND, `self-measured seam mismatch ${result.seamMismatch}`);
  assert.equal(result.warnings.filter((w) => w.code === 'seams-visible').length, 0);
});

test('without the camera focal length, it is estimated close to the truth and the seams stay within bound', async () => {
  const ys = yaws(3);
  const result = await stitchPanorama(ys.map((y) => frame(scene, y)));
  assert.ok(result.ok, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.focalSource, 'estimated');
  assert.ok(result.warnings.some((w) => w.code === 'focal-estimated'));
  assert.ok(Math.abs(result.focalPx - F) / F < 0.15, `focal ${result.focalPx}`);
  assert.ok(result.seamMismatch < SEAM_BOUND, `self-measured seam mismatch ${result.seamMismatch}`);
});

test('frames shot right to left stitch the same way', async () => {
  const ys = yaws(3).reverse();
  const result = await stitchPanorama(ys.map((y) => frame(scene, y)), { focalPx: F });
  assert.ok(result.ok, JSON.stringify(result));
  if (!result.ok) return;
  const e = errors(scene, result, ys);
  assert.ok(e.seam < SEAM_BOUND, `seam error ${e.seam}`);
});

test('a darker frame is matched to its neighbours, and the gain is recorded', async () => {
  const ys = yaws(3);
  const frames = ys.map((y, i) => frame(scene, y, i === 2 ? 0.8 : 1));
  const matched = await stitchPanorama(frames, { focalPx: F });
  assert.ok(matched.ok);
  if (!matched.ok) return;
  for (const g of matched.gains[2]) assert.ok(Math.abs(g - 1.25) < 0.04, `gain ${g}`);
  assert.ok(matched.seamMismatch < SEAM_BOUND, `seam ${matched.seamMismatch}`);
  const unmatched = await stitchPanorama(frames, { focalPx: F, matchExposure: false });
  assert.ok(unmatched.ok);
  if (!unmatched.ok) return;
  assert.ok(unmatched.seamMismatch > matched.seamMismatch * 2, `${unmatched.seamMismatch} vs ${matched.seamMismatch}`);
});

test('the crop is honest: every output pixel came from a real frame, and nothing outside the frames is kept', async () => {
  const result = await stitchPanorama(yaws(2).map((y) => frame(scene, y)), { focalPx: F });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.ok(result.crop.width < result.crop.fullWidth && result.crop.height < result.crop.fullHeight);
  // A black (0) pixel would be fill; the texture never goes below 0.08.
  for (let i = 0; i < result.data.length; i += 3) assert.ok(result.data[i] + result.data[i + 1] + result.data[i + 2] > 0, `pixel ${i / 3} is empty`);
});

test('frames of different scenes are refused rather than forced together', async () => {
  const other = texture(99);
  const result = await stitchPanorama([frame(scene, 0), frame(other, 0.6)], { focalPx: F });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.reason === 'unrelated' || result.reason === 'ambiguous', result.reason);
  assert.equal(result.frameNumber, 2);
});

test('flat frames, too few frames, different sizes and a vertical sweep are refused with a reason', async () => {
  const flat: PanoSource = { width: FW, height: FH, data: new Uint8ClampedArray(FW * FH * 4).fill(128), bits: 8 };
  assert.deepEqual(await stitchPanorama([flat, flat]), { ok: false, reason: 'too-flat', frameNumber: 1 });
  assert.deepEqual(await stitchPanorama([frame(scene, 0)]), { ok: false, reason: 'too-few' });
  const small: PanoSource = { width: 10, height: 10, data: new Uint8ClampedArray(400), bits: 8 };
  assert.deepEqual(await stitchPanorama([frame(scene, 0), small]), { ok: false, reason: 'size-mismatch', frameNumber: 2 });
  // Vertical: two crops of the texture one above the other.
  const crop = (top: number): PanoSource => {
    const w = 300, h = 160, data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) data[(y * w + x) * 4 + c] = Math.round(255 * scene[((y + top) * TW + x + 500) * 3 + c]);
      data[(y * w + x) * 4 + 3] = 255;
    }
    return { width: w, height: h, data, bits: 8 };
  };
  const vertical = await stitchPanorama([crop(20), crop(110)], { focalPx: 100000 });
  assert.deepEqual(vertical, { ok: false, reason: 'vertical', frameNumber: 2 });
});

test('an output larger than the device can hold is refused, not shrunk', async () => {
  const result = await stitchPanorama(yaws(2).map((y) => frame(scene, y)), { focalPx: F, maxOutputPixels: 20_000 });
  assert.deepEqual(result, { ok: false, reason: 'too-large' });
});

test('Stop ends stitching', async () => {
  const controller = new AbortController();
  const frames = yaws(3).map((y) => frame(scene, y));
  const running = stitchPanorama(frames, { focalPx: F, signal: controller.signal, onProgress: (_, __, stage) => { if (stage === 'blending') controller.abort(); } });
  await assert.rejects(running, (error: unknown) => (error as Error).name === 'AbortError');
});

test('largest rectangle of covered cells', () => {
  const grid = [
    0, 1, 1, 0,
    1, 1, 1, 1,
    0, 1, 1, 0,
    0, 1, 1, 0,
  ];
  assert.deepEqual(largestRectangle(Uint8Array.from(grid), 4, 4), { x: 1, y: 0, width: 2, height: 4 });
  assert.deepEqual(largestRectangle(new Uint8Array(4), 2, 2), { x: 0, y: 0, width: 0, height: 0 });
});

test('focal length from the 35 mm equivalent uses the long edge; unknown stays unknown', () => {
  assert.equal(focalPxFrom35mm(36, 6000, 4000), 6000);
  assert.equal(focalPxFrom35mm(18, 4000, 6000), 3000);
  assert.equal(focalPxFrom35mm(undefined, 6000, 4000), null);
  assert.equal(focalPxFrom35mm(0, 6000, 4000), null);
});

test('the recipe records sources, placement, gains and crop, and a damaged recipe is rejected', async () => {
  const result = await stitchPanorama(yaws(2).map((y) => frame(scene, y)), { focalPx: F });
  assert.ok(result.ok);
  if (!result.ok) return;
  const recipe = panoramaRecipe(result, [
    { frameId: 'a', stableKey: 'k-a', filename: 'pano_1.jpg', originalSha256: 'ab'.repeat(32) },
    { frameId: 'b', stableKey: 'k-b', filename: 'pano_2.jpg' },
  ], 'original', 1_800_000_000_000);
  const stored = JSON.parse(JSON.stringify(recipe));
  assert.deepEqual(readPanoramaRecipe(stored), recipe);
  assert.equal(recipe.generatedPixels, false);
  assert.equal(recipe.output.width, result.width);
  assert.equal(readPanoramaRecipe({ ...stored, generatedPixels: true }), null);
  assert.equal(readPanoramaRecipe({ ...stored, sources: stored.sources.slice(0, 1) }), null);
  assert.equal(readPanoramaRecipe({ ...stored, crop: { ...stored.crop, x: stored.crop.fullWidth } }), null);
  assert.equal(readPanoramaRecipe({ ...stored, output: { ...stored.output, width: stored.output.width + 1 } }), null);
  assert.equal(readPanoramaRecipe(null), null);
});

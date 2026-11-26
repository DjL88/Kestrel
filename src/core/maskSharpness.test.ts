import test from 'node:test';
import assert from 'node:assert/strict';
import { boxSharpness } from './objectDetection';
import { CULL_MASK_SHARPNESS_KEY, MIN_MASK_PIXELS, boxInMask, cullMaskSharpnessOn, maskedSharpness, usableMask, type SubjectMaskPixels } from './maskSharpness';
import { scoreWithSubject, type CullSuggestion } from './autoCull';
import { evaluateCullBenchmark, type CullBenchmarkCase } from './cullBenchmark';

/**
 * Synthetic scenes, NOT a real-shoot measurement: an elliptical subject (sharp or soft texture) on flat sky, a sharp
 * branch tangle or soft bokeh, with its exact mask. They test what the measurement does when the box holds more than
 * the subject; how EfficientSAM's masks behave on real photos is a separate question this file cannot answer.
 */
const W = 160;
const H = 120;

function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

function blur(values: Float32Array, radius: number): Float32Array {
  let out = values;
  for (let pass = 0; pass < 2; pass += 1) {
    const next = new Float32Array(W * H);
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
      let sum = 0; let n = 0;
      for (let d = -radius; d <= radius; d += 1) {
        const xx = pass === 0 ? Math.min(W - 1, Math.max(0, x + d)) : x;
        const yy = pass === 1 ? Math.min(H - 1, Math.max(0, y + d)) : y;
        sum += out[yy * W + xx]; n += 1;
      }
      next[y * W + x] = sum / n;
    }
    out = next;
  }
  return out;
}

type Background = 'sky' | 'branches' | 'bokeh';
interface Scene { rgba: Uint8ClampedArray; mask: SubjectMaskPixels }

function scene(seed: number, sharp: boolean, background: Background, fill: number): Scene {
  const rnd = random(seed);
  const texture = new Float32Array(W * H).map(() => (rnd() - 0.5) * 70);
  const subject = sharp ? texture : blur(texture, 3);
  let back: Float32Array;
  if (background === 'sky') back = new Float32Array(W * H).map((_, i) => 170 + (Math.floor(i / W) / H) * 30);
  else {
    const lines = new Float32Array(W * H).fill(120);
    for (let k = 0; k < 40; k += 1) {
      const x0 = rnd() * W; const y0 = rnd() * H; const angle = rnd() * Math.PI; const tone = rnd() < 0.5 ? 30 : 220;
      for (let t = -W; t < W; t += 0.5) {
        const x = Math.round(x0 + Math.cos(angle) * t); const y = Math.round(y0 + Math.sin(angle) * t);
        if (x >= 0 && x < W && y >= 0 && y < H) lines[y * W + x] = tone;
      }
    }
    back = background === 'branches' ? lines : blur(lines, 4);
  }
  const data = new Uint8Array(W * H);
  const rgba = new Uint8ClampedArray(W * H * 4);
  const rx = (W / 2) * fill; const ry = (H / 2) * fill;
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const i = y * W + x;
    const inside = ((x - W / 2) / rx) ** 2 + ((y - H / 2) / ry) ** 2 <= 1;
    data[i] = inside ? 1 : 0;
    const v = inside ? 110 + subject[i] : back[i];
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255;
  }
  return { rgba, mask: { w: W, h: H, data, score: 0.9 } };
}

const whole = { x: 0, y: 0, w: W, h: H };

test('an all-subject mask gives exactly the box value', () => {
  const { rgba } = scene(1, true, 'sky', 1);
  const all: SubjectMaskPixels = { w: W, h: H, data: new Uint8Array(W * H).fill(1), score: 0.9 };
  assert.ok(Math.abs(maskedSharpness(rgba, W, H, all, whole, W, H)! - boxSharpness(rgba, W, H)) < 1e-6);
});

test('a sharp branch cannot lift a soft subject, and flat sky cannot drag a sharp one down', () => {
  const soft = scene(2, false, 'branches', 0.6);
  const sharp = scene(3, true, 'sky', 0.45);
  const softBox = boxSharpness(soft.rgba, W, H);
  const softMask = maskedSharpness(soft.rgba, W, H, soft.mask, whole, W, H)!;
  const sharpBox = boxSharpness(sharp.rgba, W, H);
  const sharpMask = maskedSharpness(sharp.rgba, W, H, sharp.mask, whole, W, H)!;
  assert.ok(softMask < softBox, `soft subject: mask ${softMask} should read below box ${softBox}`);
  assert.ok(sharpMask > sharpBox, `sharp subject: mask ${sharpMask} should read above box ${sharpBox}`);
});

test('too small, low-scored, whole-frame or malformed masks are refused, so the box value is kept', () => {
  const { rgba } = scene(4, true, 'sky', 1);
  const tiny = new Uint8Array(W * H); tiny[60 * W + 80] = 1;
  assert.equal(maskedSharpness(rgba, W, H, { w: W, h: H, data: tiny, score: 0.9 }, whole, W, H), null);
  assert.ok(MIN_MASK_PIXELS > 1);
  assert.equal(usableMask({ w: W, h: H, data: tiny, score: 0.2 }), false);
  assert.equal(usableMask({ w: W, h: H, data: new Uint8Array(W * H).fill(1), score: 0.9 }), false);
  assert.equal(usableMask({ w: W, h: H, data: new Uint8Array(10), score: 0.9 }), false);
  assert.equal(usableMask({ w: W, h: H, data: tiny, score: Number.NaN }), false);
  assert.equal(usableMask(null), false);
  assert.equal(usableMask({ w: W, h: H, data: tiny, score: 0.9 }), true);
});

test('a crop maps onto the mask through picture coordinates', () => {
  // The picture is twice the mask; the crop is its right half, where the subject is.
  const mask: SubjectMaskPixels = { w: 20, h: 10, data: new Uint8Array(200), score: 0.9 };
  for (let y = 0; y < 10; y += 1) for (let x = 10; x < 20; x += 1) mask.data[y * 20 + x] = 1;
  const { rgba } = scene(5, true, 'sky', 1);
  const right = maskedSharpness(rgba, W, H, mask, { x: 20, y: 0, w: 20, h: 20 }, 40, 20);
  const left = maskedSharpness(rgba, W, H, mask, { x: 0, y: 0, w: 20, h: 20 }, 40, 20);
  assert.ok(right !== null && right > 0);
  assert.equal(left, null);
  assert.deepEqual(boxInMask({ x: 100, y: 50, w: 200, h: 100 }, 1000, 500, { w: 100, h: 50 }), { x: 10, y: 5, w: 20, h: 10 });
});

test('the preview switch is off unless this device sets it', () => {
  assert.equal(cullMaskSharpnessOn(null), false);
  assert.equal(cullMaskSharpnessOn({ getItem: () => null }), false);
  assert.equal(cullMaskSharpnessOn({ getItem: (key) => (key === CULL_MASK_SHARPNESS_KEY ? '1' : null) }), true);
  assert.equal(cullMaskSharpnessOn({ getItem: () => { throw new Error('blocked'); } }), false);
});

/**
 * Box versus mask on docs/CULL-BENCHMARK.md's harness, over the synthetic scenes: four subject categories, three
 * backgrounds, two subject sizes, sharp (favourite) and soft (unusable), three seeds each. The real thresholds
 * (judgeSubject) decide; nothing here is tuned. Recall must be no worse with masks.
 */
export function syntheticBoxVersusMask() {
  const categories: CullBenchmarkCase['category'][] = ['birds', 'aircraft', 'people', 'mammals'];
  const labels: CullBenchmarkCase[] = [];
  const box: CullSuggestion[] = [];
  const masked: CullSuggestion[] = [];
  let seed = 100;
  for (const category of categories) for (const background of ['sky', 'branches', 'bokeh'] as const)
    for (const fill of [0.45, 0.75]) for (const sharp of [true, false]) for (let k = 0; k < 3; k += 1) {
      const id = `${category}-${background}-${fill}-${sharp ? 'sharp' : 'soft'}-${k}`;
      const s = scene(seed += 1, sharp, background, fill);
      labels.push({ id, category, favourite: sharp, unusable: !sharp });
      const base: CullSuggestion = { frameId: id, decision: null, confidence: 'low', score: 40, reason: 'limitedDetail' };
      const judge = (sharpness: number) => scoreWithSubject(base, { label: category, score: 0.85, size: 600, sharpness });
      box.push(judge(boxSharpness(s.rgba, W, H)));
      masked.push(judge(maskedSharpness(s.rgba, W, H, s.mask, whole, W, H) ?? boxSharpness(s.rgba, W, H)));
    }
  const summary = (predictions: CullSuggestion[]) => {
    const result = evaluateCullBenchmark(labels, predictions);
    const unusableKept = predictions.filter((p, i) => p.decision === 'keep' && labels[i].unusable).length;
    const favouritesKept = predictions.filter((p, i) => p.decision === 'keep' && labels[i].favourite).length;
    return { recall: result.recall, autoKeepPrecision: result.autoKeepPrecision, review: predictions.filter((p) => p.decision === null).length, unusableKept, favouritesKept };
  };
  return { frames: labels.length, box: summary(box), mask: summary(masked) };
}

test('synthetic benchmark: masked sharpness keeps recall and stops soft subjects on sharp backgrounds being auto-kept', () => {
  const { box, mask, frames } = syntheticBoxVersusMask();
  if (process.env.KESTREL_BENCH === '1') console.log(JSON.stringify({ frames, box, mask }, null, 2));
  assert.ok((mask.recall ?? 0) >= (box.recall ?? 0), `recall mask ${mask.recall} < box ${box.recall}`);
  assert.ok(mask.unusableKept <= box.unusableKept);
  assert.ok(mask.favouritesKept >= box.favouritesKept);
  // judgeSubject never rejects, so neither method can lose a favourite on this harness.
  assert.equal(mask.recall, 1);
});

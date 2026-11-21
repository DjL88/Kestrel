import assert from 'node:assert/strict';
import test from 'node:test';
import { sharpnessMap, stackFrames, StackCancelledError, type StackFrame } from './focusStack.ts';

/** Deterministic pseudo-random numbers, so every run sees the same synthetic scene. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

function blurPlane(src: Float32Array, w: number, h: number, radius: number, passes = 2): Float32Array {
  let cur = src;
  for (let pass = 0; pass < passes; pass++) {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) s += cur[y * w + Math.min(w - 1, Math.max(0, x + k))];
      tmp[y * w + x] = s / (2 * radius + 1);
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) s += tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x];
      out[y * w + x] = s / (2 * radius + 1);
    }
    cur = out;
  }
  return cur;
}

/** A detailed scene: noise at several scales, in three correlated channels. Values 0 to 1. */
function scene(w: number, h: number, seed: number): Float32Array[] {
  const rand = rng(seed);
  const noise = () => Float32Array.from({ length: w * h }, rand);
  const fine = noise(), mid = blurPlane(noise(), w, h, 2, 1), coarse = blurPlane(noise(), w, h, 8, 2);
  const lum = new Float32Array(w * h);
  for (let i = 0; i < lum.length; i++) lum[i] = 0.5 + 0.9 * (fine[i] - 0.5) * 0.6 + 1.2 * (mid[i] - 0.5) + 2 * (coarse[i] - 0.5);
  const clamp = (v: Float32Array) => v.map((x) => Math.min(1, Math.max(0, x)));
  return [clamp(lum), clamp(lum.map((x, i) => x * 0.9 + 0.1 * fine[i])), clamp(lum.map((x, i) => x * 0.8 + 0.2 * mid[i]))];
}

function toFrame(planes: Float32Array[], w: number, h: number, kind: 'u8' | 'u16' = 'u8'): StackFrame {
  const data = kind === 'u8' ? new Uint8ClampedArray(w * h * 4) : new Uint16Array(w * h * 4);
  const max = kind === 'u8' ? 255 : 65535;
  for (let i = 0; i < w * h; i++) {
    for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(planes[c][i] * max);
    data[i * 4 + 3] = max;
  }
  return { width: w, height: h, data };
}

/** A frame where `sharpMask(x)` (0 to 1) says how much of the sharp scene shows through; the rest is blurred. */
function focusFrame(sharp: Float32Array[], w: number, h: number, sharpMask: (x: number, y: number) => number, kind: 'u8' | 'u16' = 'u8'): StackFrame {
  const soft = sharp.map((p) => blurPlane(p, w, h, 4, 3));
  const planes = sharp.map((p, c) => p.map((v, i) => { const m = sharpMask(i % w, Math.floor(i / w)); return v * m + soft[c][i] * (1 - m); }));
  return toFrame(planes, w, h, kind);
}

/** Warp a scene by a shift (pixels), for frames that moved between shots. */
function shifted(planes: Float32Array[], w: number, h: number, dx: number, dy: number): Float32Array[] {
  return planes.map((p) => {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = Math.min(w - 1, Math.max(0, x + dx)), v = Math.min(h - 1, Math.max(0, y + dy));
      const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
      const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
      out[y * w + x] = (p[y0 * w + x0] * (1 - fx) + p[y0 * w + x1] * fx) * (1 - fy) + (p[y1 * w + x0] * (1 - fx) + p[y1 * w + x1] * fx) * fy;
    }
    return out;
  });
}

function lumOf(frame: StackFrame, region?: { x0: number; x1: number; y0: number; y1: number }) {
  const max = frame.data instanceof Uint16Array ? 65535 : frame.data instanceof Float32Array ? 1 : 255;
  const out = new Float32Array(frame.width * frame.height);
  for (let i = 0; i < out.length; i++) out[i] = (0.2126 * frame.data[i * 4] + 0.7152 * frame.data[i * 4 + 1] + 0.0722 * frame.data[i * 4 + 2]) / max;
  void region;
  return out;
}

function meanSharpness(frame: StackFrame, x0: number, x1: number, y0 = 10, y1 = frame.height - 10): number {
  const map = sharpnessMap(lumOf(frame), frame.width, frame.height, 1);
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { sum += map[y * frame.width + x]; n++; }
  return sum / n;
}

function mse(a: StackFrame, truth: Float32Array[], x0: number, x1: number): number {
  const lum = lumOf(a);
  const t = truth[0].map((_, i) => 0.2126 * truth[0][i] + 0.7152 * truth[1][i] + 0.0722 * truth[2][i]);
  let sum = 0, n = 0;
  for (let y = 12; y < a.height - 12; y++) for (let x = x0; x < x1; x++) { const e = lum[y * a.width + x] - t[y * a.width + x]; sum += e * e; n++; }
  return sum / n;
}

const W = 192, H = 128;

// Each frame is sharp on its own side and they overlap in the middle, as neighbouring focus distances do.
test('two half-sharp frames merge into an all-sharp result', async () => {
  const truth = scene(W, H, 7);
  const left = focusFrame(truth, W, H, (x) => Math.min(1, Math.max(0, (W * 0.65 - x) / (W * 0.3))));
  const right = focusFrame(truth, W, H, (x) => Math.min(1, Math.max(0, (x - W * 0.35) / (W * 0.3))));
  const result = await stackFrames([left, right]);
  assert.ok(result.ok);
  if (!result.ok) return;
  const sharpLeft = meanSharpness(toFrame(truth, W, H), 14, 60), sharpRight = meanSharpness(toFrame(truth, W, H), 132, 178);
  for (const [x0, x1, own, expected] of [[14, 60, left, sharpLeft], [132, 178, right, sharpRight]] as const) {
    const merged = meanSharpness(result as unknown as StackFrame, x0, x1);
    const alone = meanSharpness(own, x0, x1);
    assert.ok(merged > 0.85 * expected, `detail kept in ${x0}-${x1}: ${merged} of ${expected}`);
    assert.ok(merged > 2.5 * meanSharpness(own === left ? right : left, x0, x1), 'far sharper than the frame that was blurred there');
    void alone;
  }
  // The blurry halves are clearly worse than the merged result against the truth.
  const blurRight = mse(left, truth, 132, 178), blurLeft = mse(right, truth, 14, 60);
  assert.ok(mse(result as unknown as StackFrame, truth, 132, 178) < blurRight / 4);
  assert.ok(mse(result as unknown as StackFrame, truth, 14, 60) < blurLeft / 4);
  // Each frame supplied roughly its own half.
  assert.ok(result.contribution[0] > 0.3 && result.contribution[1] > 0.3);
  assert.equal(result.bitDepth, 8);
  assert.ok(result.data instanceof Uint8ClampedArray);
});

test('frames that moved a few pixels are aligned before merging', async () => {
  const truth = scene(W, H, 11);
  const a = focusFrame(truth, W, H, (x) => (x < W / 2 ? 1 : 0));
  const b = focusFrame(shifted(truth, W, H, 3, -2), W, H, (x) => (x < W / 2 - 3 ? 0 : 1));
  const c = focusFrame(shifted(truth, W, H, -2, 1), W, H, () => 0.5);
  const result = await stackFrames([a, c, b]);
  assert.ok(result.ok);
  if (!result.ok) return;
  const outer = result.alignment.filter((_, i) => i !== result.referenceIndex);
  assert.ok(outer.some((m) => Math.abs(m.dx) > 1.5 || Math.abs(m.dy) > 1.5), 'a shift was found');
  const shiftB = result.alignment[2];
  assert.ok(Math.abs(shiftB.dx - -5) < 1.5 && Math.abs(shiftB.dy - 3) < 1.5, `chained shift found: ${JSON.stringify(shiftB)}`);
  // Fine detail is present on both sides of the picture, so it was not smeared by a mis-registration.
  assert.ok(meanSharpness(result as unknown as StackFrame, 20, 70) > 0.6 * meanSharpness(toFrame(truth, W, H), 20, 70));
  assert.ok(meanSharpness(result as unknown as StackFrame, 120, 170) > 0.6 * meanSharpness(toFrame(truth, W, H), 120, 170));
});

test('unrelated frames are refused, calmly, and nothing is produced', async () => {
  const one = toFrame(scene(W, H, 1), W, H), two = toFrame(scene(W, H, 99), W, H);
  const result = await stackFrames([one, two]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'unrelated');
  assert.match(result.message, /untouched/);
  assert.doesNotMatch(result.message, /error|failed|exception/i);
});

test('a repeating pattern is refused as ambiguous rather than guessed', async () => {
  const stripes = (phase: number) => {
    const p = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) p[y * W + x] = 0.5 + 0.4 * Math.sin(((x + phase) * 2 * Math.PI) / 12);
    return toFrame([p, p, p], W, H);
  };
  const result = await stackFrames([stripes(0), stripes(5)]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'ambiguous');
});

test('flat frames, mismatched sizes and a single frame are refused', async () => {
  const flat = toFrame([new Float32Array(W * H).fill(0.5), new Float32Array(W * H).fill(0.5), new Float32Array(W * H).fill(0.5)], W, H);
  const flatResult = await stackFrames([flat, flat]);
  assert.ok(!flatResult.ok && flatResult.reason === 'too-flat');
  const small = toFrame(scene(96, 64, 3), 96, 64), big = toFrame(scene(W, H, 3), W, H);
  const mismatch = await stackFrames([small, big]);
  assert.ok(!mismatch.ok && mismatch.reason === 'size-mismatch');
  const single = await stackFrames([big]);
  assert.ok(!single.ok && single.reason === 'too-few');
});

test('16-bit sources stay 16-bit and keep their precision', async () => {
  const truth = scene(W, H, 5);
  const a = focusFrame(truth, W, H, (x) => (x < W / 2 ? 1 : 0), 'u16');
  const b = focusFrame(truth, W, H, (x) => (x < W / 2 ? 0 : 1), 'u16');
  const result = await stackFrames([a, b]);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.bitDepth, 16);
  assert.ok(result.data instanceof Uint16Array);
  const levels = new Set<number>();
  for (let i = 0; i < W * H; i++) levels.add(result.data[i * 4]);
  assert.ok(levels.size > 600, `more than 256 grey levels survive (${levels.size})`);
});

test('working in small bands gives the same picture as one pass, within rounding', async () => {
  const truth = scene(W, H, 21);
  const a = focusFrame(truth, W, H, (x) => (x < W / 2 ? 1 : 0)), b = focusFrame(truth, W, H, (x) => (x < W / 2 ? 0 : 1));
  const whole = await stackFrames([a, b]);
  const banded = await stackFrames([a, b], { maxWorkingBytes: 1 }); // forces the smallest bands
  assert.ok(whole.ok && banded.ok);
  if (!whole.ok || !banded.ok) return;
  assert.equal(whole.bands, 1);
  assert.ok(banded.bands > 1, `used ${banded.bands} bands`);
  let big = 0;
  for (let i = 0; i < whole.data.length; i++) if (Math.abs(whole.data[i] - banded.data[i]) > 6) big++;
  assert.ok(big / whole.data.length < 0.01, `${big} samples differ noticeably`);
});

test('stopping part-way throws a cancellation and reports progress up to then', async () => {
  const truth = scene(W, H, 2);
  const frames = [0, 1, 2].map((i) => focusFrame(truth, W, H, (x) => (x * 3 >= i * W && x * 3 < (i + 1) * W ? 1 : 0)));
  const controller = new AbortController();
  const seen: string[] = [];
  await assert.rejects(stackFrames(frames, { signal: controller.signal, onProgress: (done, total, stage) => { seen.push(`${stage}:${done}/${total}`); if (stage === 'fusing') controller.abort(); } }), StackCancelledError);
  assert.ok(seen.some((s) => s.startsWith('aligning')) && seen.some((s) => s.startsWith('fusing')));
});

test('identical frames warn that stacking will not help', async () => {
  const frame = toFrame(scene(W, H, 8), W, H);
  const result = await stackFrames([frame, frame]);
  assert.ok(result.ok);
  if (result.ok) assert.ok(result.warnings.some((w) => w.code === 'equally-sharp'));
});

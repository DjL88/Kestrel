import assert from 'node:assert/strict';
import test from 'node:test';
import { meanSharpness, sharpnessMap, stackFrames, StackCancelledError, type StackFrame, type StackSuccess } from './focusStack.ts';

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


const asFrame = (r: StackSuccess): StackFrame => ({ width: r.width, height: r.height, data: r.data });

function lumOf(frame: StackFrame) {
  const max = frame.data instanceof Uint16Array ? 65535 : frame.data instanceof Float32Array ? 1 : 255;
  const out = new Float32Array(frame.width * frame.height);
  for (let i = 0; i < out.length; i++) out[i] = (0.2126 * frame.data[i * 4] + 0.7152 * frame.data[i * 4 + 1] + 0.0722 * frame.data[i * 4 + 2]) / max;
  return out;
}

function regionSharpness(frame: StackFrame, x0: number, x1: number, y0 = 10, y1 = frame.height - 10): number {
  const map = sharpnessMap(lumOf(frame), frame.width, frame.height, 1);
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { sum += map[y * frame.width + x]; n++; }
  return sum / n;
}

const sharpnessOf = (f: StackFrame) => meanSharpness(f.width, f.height, f.data, 12);

function mse(a: StackFrame, truth: Float32Array[], x0: number, x1: number): number {
  const lum = lumOf(a);
  const t = truth[0].map((_, i) => 0.2126 * truth[0][i] + 0.7152 * truth[1][i] + 0.0722 * truth[2][i]);
  let sum = 0, n = 0;
  for (let y = 12; y < a.height - 12; y++) for (let x = x0; x < x1; x++) { const e = lum[y * a.width + x] - t[y * a.width + x]; sum += e * e; n++; }
  return sum / n;
}

/** A synthetic focus bracket: `count` frames, each sharp in its own vertical slice, blurred elsewhere, smooth hand-over. */
function bracket(truth: Float32Array[], w: number, h: number, count: number, kind: 'u8' | 'u16' = 'u8') {
  return Array.from({ length: count }, (_, i) => focusFrame(truth, w, h, (x) => {
    const centre = ((i + 0.5) / count) * w, half = w / count / 2;
    return Math.min(1, Math.max(0, 1 - (Math.abs(x - centre) - half) / (half * 0.6)));
  }, kind));
}

const W = 192, H = 128;

test('a five-frame focus bracket: the stack is sharper than every input frame, and close to the all-sharp truth', async () => {
  const truth = scene(W, H, 7);
  const frames = bracket(truth, W, H, 5);
  const result = await stackFrames(frames);
  assert.ok(result.ok, JSON.stringify(result));
  if (!result.ok) return;
  const merged = sharpnessOf(asFrame(result));
  const inputs = frames.map(sharpnessOf);
  const ideal = sharpnessOf(toFrame(truth, W, H));
  for (const [i, s] of inputs.entries()) assert.ok(merged > s * 1.3, `stack ${merged.toFixed(4)} beats frame ${i + 1} ${s.toFixed(4)} clearly`);
  assert.ok(merged > 0.8 * ideal, `stack keeps ${(merged / ideal * 100).toFixed(0)}% of the all-sharp detail`);
  // Every frame supplied part of the picture, roughly its own slice.
  for (const share of result.contribution) assert.ok(share > 0.1, `contribution ${result.contribution}`);
  assert.equal(result.sourceBits, 8);
  assert.ok(result.data instanceof Uint16Array);
});

test('no pixel is generated: every output sample lies within the aligned frames at that place', async () => {
  const truth = scene(W, H, 3);
  const frames = bracket(truth, W, H, 3);
  const result = await stackFrames(frames, { localAlign: false });
  assert.ok(result.ok);
  if (!result.ok) return;
  // These frames were shot without moving, so alignment stays within a fraction of a pixel of where they are.
  for (const a of result.alignment) assert.ok(Math.abs(a.dx) < 1 && Math.abs(a.dy) < 1 && Math.abs(a.scale - 1) < 0.01, JSON.stringify(a));
  // Every output sample lies between the darkest and brightest real sample of the frames at that place (within the
  // one pixel the sub-pixel alignment can move it). A sharpening filter or a generator would overshoot this range.
  let outside = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    for (let c = 0; c < 3; c++) {
      let lo = 1, hi = 0;
      for (const f of frames) for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const yy = Math.min(H - 1, Math.max(0, y + oy)), xx = Math.min(W - 1, Math.max(0, x + ox));
        const v = f.data[(yy * W + xx) * 4 + c] / 255; lo = Math.min(lo, v); hi = Math.max(hi, v);
      }
      const v = result.data[(y * W + x) * 4 + c] / 65535;
      if (v < lo - 0.5 / 255 || v > hi + 0.5 / 255) outside++;
    }
  }
  assert.equal(outside, 0, `${outside} samples outside the real source range`);
});

test('two half-sharp frames merge into an all-sharp result, far better than either against the truth', async () => {
  const truth = scene(W, H, 7);
  const left = focusFrame(truth, W, H, (x) => Math.min(1, Math.max(0, (W * 0.65 - x) / (W * 0.3))));
  const right = focusFrame(truth, W, H, (x) => Math.min(1, Math.max(0, (x - W * 0.35) / (W * 0.3))));
  const result = await stackFrames([left, right]);
  assert.ok(result.ok);
  if (!result.ok) return;
  const merged = asFrame(result);
  for (const [x0, x1, blurred] of [[14, 60, right], [132, 178, left]] as const) {
    assert.ok(regionSharpness(merged, x0, x1) > 2.5 * regionSharpness(blurred, x0, x1), `far sharper than the blurred frame in ${x0}-${x1}`);
    assert.ok(mse(merged, truth, x0, x1) < mse(blurred, truth, x0, x1) / 4);
  }
  assert.ok(result.contribution[0] > 0.3 && result.contribution[1] > 0.3);
});

test('frames that moved a few pixels are aligned globally before merging', async () => {
  const truth = scene(W, H, 11);
  const a = focusFrame(truth, W, H, (x) => (x < W / 2 ? 1 : 0));
  const b = focusFrame(shifted(truth, W, H, 3, -2), W, H, (x) => (x < W / 2 - 3 ? 0 : 1));
  const c = focusFrame(shifted(truth, W, H, -2, 1), W, H, () => 0.5);
  const result = await stackFrames([a, c, b]);
  assert.ok(result.ok);
  if (!result.ok) return;
  const shiftB = result.alignment[2];
  assert.ok(Math.abs(shiftB.dx - -5) < 1 && Math.abs(shiftB.dy - 3) < 1, `chained shift found: ${JSON.stringify(shiftB)}`);
  const merged = asFrame(result), ideal = toFrame(truth, W, H);
  assert.ok(regionSharpness(merged, 20, 70) > 0.6 * regionSharpness(ideal, 20, 70));
  assert.ok(regionSharpness(merged, 120, 170) > 0.6 * regionSharpness(ideal, 120, 170));
});

test('local alignment corrects a part of the picture that moved on its own (a swaying perch)', async () => {
  const w = 256, h = 192;
  const truth = scene(w, h, 17);
  // Frame 2's right half moved 2 px down and 2 px left relative to the rest: one global transform cannot fix both halves.
  const moved = shifted(truth, w, h, 2, 2);
  const mixed = truth.map((plane, c) => plane.map((v, i) => (i % w > w / 2 ? moved[c][i] : v)));
  const a = focusFrame(truth, w, h, () => 0.55);
  const b = focusFrame(mixed, w, h, () => 0.6);
  const globalOnly = await stackFrames([a, b], { localAlign: false });
  const local = await stackFrames([a, b]);
  assert.ok(globalOnly.ok && local.ok);
  if (!globalOnly.ok || !local.ok) return;
  const other = local.alignment[1 - local.referenceIndex];
  assert.ok(other.localTiles.matched > other.localTiles.total / 2, JSON.stringify(other.localTiles));
  assert.ok(other.localTiles.maxShift > 0.9 && other.localTiles.maxShift < 4, `residual found: ${other.localTiles.maxShift}`);
  // Mis-registration smears detail: the locally aligned stack keeps more of it on the moved side.
  const right = (r: StackSuccess) => regionSharpness(asFrame(r), w / 2 + 24, w - 16);

  assert.ok(right(local) > right(globalOnly) * 1.05, `local ${right(local)} vs global ${right(globalOnly)}`);
});

test('unrelated frames are refused, and nothing is produced', async () => {
  const one = toFrame(scene(W, H, 1), W, H), two = toFrame(scene(W, H, 99), W, H);
  const result = await stackFrames([one, two]);
  assert.equal(result.ok, false);
  if (!result.ok) { assert.equal(result.reason, 'unrelated'); assert.equal(result.frameNumber, 2); }
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

test('flat frames, mismatched sizes, one frame and too many frames are refused', async () => {
  const flat = toFrame([new Float32Array(W * H).fill(0.5), new Float32Array(W * H).fill(0.5), new Float32Array(W * H).fill(0.5)], W, H);
  const flatResult = await stackFrames([flat, flat]);
  assert.ok(!flatResult.ok && flatResult.reason === 'too-flat');
  const small = toFrame(scene(96, 64, 3), 96, 64), big = toFrame(scene(W, H, 3), W, H);
  const mismatch = await stackFrames([small, big]);
  assert.ok(!mismatch.ok && mismatch.reason === 'size-mismatch');
  const single = await stackFrames([big]);
  assert.ok(!single.ok && single.reason === 'too-few');
  const many = await stackFrames(Array.from({ length: 31 }, () => small));
  assert.ok(!many.ok && many.reason === 'too-many');
});

test('16-bit sources keep their precision', async () => {
  const truth = scene(W, H, 5);
  const frames = bracket(truth, W, H, 2, 'u16');
  const result = await stackFrames(frames);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.sourceBits, 16);
  const levels = new Set<number>();
  for (let i = 0; i < W * H; i++) levels.add(result.data[i * 4]);
  assert.ok(levels.size > 600, `more than 256 grey levels survive (${levels.size})`);
});

test('working in small bands gives the same picture as one pass', async () => {
  const truth = scene(W, H, 21);
  const frames = bracket(truth, W, H, 2);
  const whole = await stackFrames(frames);
  const banded = await stackFrames(frames, { maxWorkingBytes: 1 }); // forces the smallest bands
  assert.ok(whole.ok && banded.ok);
  if (!whole.ok || !banded.ok) return;
  assert.equal(whole.bands, 1);
  assert.ok(banded.bands > 1, `used ${banded.bands} bands`);
  let big = 0;
  for (let i = 0; i < whole.data.length; i++) if (Math.abs(whole.data[i] - banded.data[i]) > 64) big++;
  assert.equal(big, 0, `${big} samples differ`);
});

test('stopping part-way throws a cancellation and reports progress up to then', async () => {
  const frames = bracket(scene(W, H, 2), W, H, 3);
  const controller = new AbortController();
  const seen: string[] = [];
  await assert.rejects(stackFrames(frames, { signal: controller.signal, onProgress: (done, total, stage) => { seen.push(`${stage}:${done}/${total}`); if (stage === 'blending') controller.abort(); } }), StackCancelledError);
  assert.ok(seen.some((s) => s.startsWith('reading')) && seen.some((s) => s.startsWith('aligning')) && seen.some((s) => s.startsWith('blending')));
  assert.ok(!seen.some((s) => s === 'blending:8/8'), 'it stopped before the end');
});

test('identical frames warn that stacking will not help', async () => {
  const frame = toFrame(scene(W, H, 8), W, H);
  const result = await stackFrames([frame, frame]);
  assert.ok(result.ok);
  if (result.ok) assert.ok(result.warnings.some((w) => w.code === 'equally-sharp'));
});

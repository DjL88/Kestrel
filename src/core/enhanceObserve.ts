import { toOklab } from './colourCheck';
import { estimateNoiseSigma } from './noiseEstimate';
import type { PhotographyObservation } from './photographyKnowledge';

/**
 * Enhance loop, step 1: OBSERVE. Measures the actual preview pixels. Pure and deterministic: no model, no network.
 * A value that could not be measured is `null` ("unknown stays unknown"), never a guess. Nothing here edits a photo.
 */

export interface SubjectEstimate {
  /** Per-pixel subject weight, 0 to 1, same size as the preview. */
  weights: Float32Array;
  coverage: number;
  /** Centre of the subject, 0 to 1 across the frame. */
  cx: number;
  cy: number;
  /** Perceptual lightness of the subject, 0 to 1. */
  median: number;
  p98: number;
  /** Median lightness of everything else. */
  backgroundMedian: number;
  /** 'segmentation' = given by an on-device subject model; 'detail' = the in-focus area measured from the pixels. */
  source: 'segmentation' | 'detail';
  confidence: 'high' | 'medium' | 'low';
  /** True when the subject touches the frame edge (a cut-off subject must never be made to look deliberate). */
  touchesEdge: boolean;
}

export interface FrameStats {
  width: number;
  height: number;
  /** Perceptual lightness percentiles, 0 to 1. */
  p01: number; p05: number; p50: number; p95: number; p99: number;
  /** Share of pixels with a channel at or near 255 (bright clipping) and with lightness near 0 (shadow crush). */
  clipHigh: number;
  clipLow: number;
  /** p95 - p05: how much of the tonal range the photo uses. */
  spread: number;
  /** Luminance noise sigma on a 0-255 scale, or null when too little flat area to measure. */
  noiseSigma: number | null;
  /** Mean Oklab a and b of near-neutral mid-tone pixels (positive b = warm, positive a = magenta), or null when there are too few to judge. */
  cast: { a: number; b: number; strength: number; direction: 'warm' | 'cool' | 'green' | 'magenta'; neutralShare: number } | null;
  /** Mean Oklab chroma of the frame. */
  meanChroma: number;
  /** Whole-frame mean Oklab a and b (grey-world). Not evidence of a cast by itself (a meadow is green); only used to size a step the vision AI asked for. */
  frameMean: { a: number; b: number };
  /** Horizon or long-edge tilt in degrees (positive = clockwise), or null when no confident straight edge. */
  tilt: { degrees: number; confidence: number } | null;
  subject: SubjectEstimate | null;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const LIN = Float32Array.from({ length: 256 }, (_, i) => toLin(i / 255));
/** Perceptual (display-referred) lightness 0-1 of an 8-bit pixel. */
export const lightness = (r: number, g: number, b: number) => {
  const y = 0.2126 * LIN[r] + 0.7152 * LIN[g] + 0.0722 * LIN[b];
  return y <= 0.0031308 ? y * 12.92 : 1.055 * y ** (1 / 2.4) - 0.055;
};

export function lumaMap(rgba: Uint8ClampedArray, n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = lightness(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
  return out;
}

export function percentile(sorted: Float32Array, p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
}

/** In-focus area measured from local gradient energy, as a stand-in when no subject model is available. */
export function estimateDetailSubject(luma: Float32Array, width: number, height: number): SubjectEstimate | null {
  const B = 12;
  const bw = Math.floor(width / B), bh = Math.floor(height / B);
  if (bw < 8 || bh < 8) return null;
  const energy = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by += 1) for (let bx = 0; bx < bw; bx += 1) {
    let sum = 0;
    for (let y = by * B + 1; y < by * B + B - 1; y += 1) for (let x = bx * B + 1; x < bx * B + B - 1; x += 1) {
      const p = y * width + x;
      sum += Math.abs(luma[p + 1] - luma[p - 1]) + Math.abs(luma[p + width] - luma[p - width]);
    }
    energy[by * bw + bx] = sum / ((B - 2) * (B - 2));
  }
  const sorted = Float32Array.from(energy).sort();
  const hi = percentile(sorted, 0.9), mid = percentile(sorted, 0.5);
  if (hi < 0.012 || hi < mid * 2) return null; // nothing clearly sharper than the rest
  const cut = Math.max(0.012, hi * 0.5);
  const hot = new Uint8Array(bw * bh);
  for (let i = 0; i < hot.length; i += 1) hot[i] = energy[i] >= cut ? 1 : 0;
  // Largest connected component (4-neighbour).
  const label = new Int32Array(bw * bh).fill(-1);
  let best = -1, bestSize = 0, id = 0;
  const stack: number[] = [];
  for (let s = 0; s < hot.length; s += 1) {
    if (!hot[s] || label[s] >= 0) continue;
    let size = 0;
    stack.push(s); label[s] = id;
    while (stack.length) {
      const c = stack.pop()!; size += 1;
      const x = c % bw, y = (c - x) / bw;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
        const q = ny * bw + nx;
        if (hot[q] && label[q] < 0) { label[q] = id; stack.push(q); }
      }
    }
    if (size > bestSize) { bestSize = size; best = id; }
    id += 1;
  }
  if (best < 0 || bestSize < 6) return null;
  const weights = new Float32Array(width * height);
  let inside = 0;
  const inLum: number[] = [], outLum: number[] = [];
  let sx = 0, sy = 0, touches = false;
  for (let by = 0; by < bh; by += 1) for (let bx = 0; bx < bw; bx += 1) {
    const mine = label[by * bw + bx] === best;
    for (let y = by * B; y < by * B + B; y += 1) for (let x = bx * B; x < bx * B + B; x += 1) {
      const p = y * width + x;
      if (mine) { weights[p] = 1; inLum.push(luma[p]); inside += 1; sx += x; sy += y; } else outLum.push(luma[p]);
    }
    if (mine && (bx === 0 || by === 0 || bx === bw - 1 || by === bh - 1)) touches = true;
  }
  const coverage = inside / (width * height);
  if (coverage < 0.01 || coverage > 0.6 || !outLum.length) return null;
  const a = Float32Array.from(inLum).sort(), o = Float32Array.from(outLum).sort();
  const contrast = hi / Math.max(mid, 1e-4);
  return {
    weights, coverage, cx: sx / inside / width, cy: sy / inside / height,
    median: percentile(a, 0.5), p98: percentile(a, 0.98), backgroundMedian: percentile(o, 0.5),
    source: 'detail', confidence: contrast >= 3 && coverage < 0.4 && !touches ? 'medium' : 'low', touchesEdge: touches,
  };
}

/** Subject statistics from a trusted per-pixel weight map (from the on-device subject model). */
export function subjectFromWeights(luma: Float32Array, weights: Float32Array, width: number, height: number, confidence: 'high' | 'medium' | 'low'): SubjectEstimate | null {
  const inL: number[] = [], outL: number[] = [];
  let sx = 0, sy = 0, touches = false;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const p = y * width + x;
    if (weights[p] >= 0.78) {
      inL.push(luma[p]); sx += x; sy += y;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touches = true;
    } else if (weights[p] <= 0.2) outL.push(luma[p]);
  }
  if (inL.length < 32 || !outL.length) return null;
  const a = Float32Array.from(inL).sort(), o = Float32Array.from(outL).sort();
  return {
    weights, coverage: inL.length / (width * height), cx: sx / inL.length / width, cy: sy / inL.length / height,
    median: percentile(a, 0.5), p98: percentile(a, 0.98), backgroundMedian: percentile(o, 0.5), source: 'segmentation', confidence, touchesEdge: touches,
  };
}

/** Tilt of the strongest near-horizontal edges, from Sobel gradients on a reduced copy. Null when it is not clear. */
export function estimateTilt(luma: Float32Array, width: number, height: number): FrameStats['tilt'] {
  const step = Math.max(1, Math.round(Math.max(width, height) / 400));
  const w = Math.floor(width / step), h = Math.floor(height / step);
  if (w < 40 || h < 40) return null;
  const g = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    let s = 0, c = 0;
    for (let dy = 0; dy < step; dy += 1) for (let dx = 0; dx < step; dx += 1) { s += luma[(y * step + dy) * width + x * step + dx]; c += 1; }
    g[y * w + x] = s / c;
  }
  const BIN = 0.25, RANGE = 12;
  const bins = new Float64Array(Math.round((RANGE * 2) / BIN) + 1);
  let strong = 0;
  for (let y = 1; y < h - 1; y += 1) for (let x = 1; x < w - 1; x += 1) {
    const p = y * w + x;
    const gx = (g[p - w + 1] + 2 * g[p + 1] + g[p + w + 1]) - (g[p - w - 1] + 2 * g[p - 1] + g[p + w - 1]);
    const gy = (g[p + w - 1] + 2 * g[p + w] + g[p + w + 1]) - (g[p - w - 1] + 2 * g[p - w] + g[p - w + 1]);
    const mag = Math.hypot(gx, gy);
    if (mag < 0.35) continue;
    // Edge direction is perpendicular to the gradient. A horizontal edge has a vertical gradient.
    let deg = (Math.atan2(gx, gy) * 180) / Math.PI;
    if (deg > 90) deg -= 180; else if (deg < -90) deg += 180;
    if (Math.abs(deg) > RANGE) continue;
    strong += 1;
    bins[Math.round((deg + RANGE) / BIN)] += mag;
  }
  if (strong < w * h * 0.004) return null;
  let total = 0;
  for (const v of bins) total += v;
  let bestI = 0, bestV = 0;
  const win = Math.round(0.75 / BIN);
  for (let i = 0; i < bins.length; i += 1) {
    let s = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(bins.length - 1, i + win); j += 1) s += bins[j];
    if (s > bestV) { bestV = s; bestI = i; }
  }
  const degrees = bestI * BIN - RANGE;
  const confidence = total > 0 ? bestV / total : 0;
  return { degrees: Math.round(degrees * 10) / 10, confidence: Math.round(confidence * 100) / 100 };
}

export interface ObserveOptions {
  /** Per-pixel subject weights from the on-device subject model, when it ran. */
  segmentation?: { weights: Float32Array; confidence: 'high' | 'medium' | 'low' } | null;
}

export function observeFrame(rgba: Uint8ClampedArray, width: number, height: number, options: ObserveOptions = {}): FrameStats {
  const n = width * height;
  const luma = lumaMap(rgba, n);
  const hist = new Uint32Array(1024);
  let clipHigh = 0, clipLow = 0, chromaSum = 0, allA = 0, allB = 0;
  const mids: number[] = [];
  const stride = Math.max(1, Math.floor(n / 200_000));
  let sampled = 0;
  for (let i = 0; i < n; i += 1) {
    const l = luma[i];
    hist[Math.min(1023, Math.floor(l * 1023.99))] += 1;
    if (Math.max(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) >= 253) clipHigh += 1;
    if (l <= 0.02) clipLow += 1;
    if (i % stride) continue;
    sampled += 1;
    const [L, a, b] = toOklab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    const c = Math.hypot(a, b);
    chromaSum += c; allA += a; allB += b;
    if (L > 0.35 && L < 0.92) mids.push(c, a, b);
  }
  const at = (p: number) => {
    let acc = 0; const target = p * n;
    for (let i = 0; i < 1024; i += 1) { acc += hist[i]; if (acc >= target) return i / 1023; }
    return 1;
  };
  const p05 = at(0.05), p95 = at(0.95);
  // Colour cast: the least coloured fifth of the mid-tones are the best available guess at "should be neutral". They only
  // count when they really are near-neutral and all lean the same way (a green meadow's least-coloured pixels do not).
  let cast: FrameStats['cast'] = null;
  const midCount = mids.length / 3;
  if (sampled > 0 && midCount >= 400 && midCount / sampled >= 0.2) {
    const order = Array.from({ length: midCount }, (_, i) => i).sort((x, y) => mids[x * 3] - mids[y * 3]);
    const pool = order.slice(0, Math.floor(midCount * 0.2));
    let ma = 0, mb = 0;
    for (const i of pool) { ma += mids[i * 3 + 1]; mb += mids[i * 3 + 2]; }
    ma /= pool.length; mb /= pool.length;
    let varSum = 0;
    for (const i of pool) varSum += (mids[i * 3 + 1] - ma) ** 2 + (mids[i * 3 + 2] - mb) ** 2;
    const spreadAB = Math.sqrt(varSum / pool.length), strength = Math.hypot(ma, mb);
    const maxChroma = mids[pool[pool.length - 1] * 3];
    if (maxChroma < 0.11 && strength >= 0.8 * spreadAB) {
      const direction = Math.abs(mb) >= Math.abs(ma) ? (mb > 0 ? 'warm' : 'cool') : (ma > 0 ? 'magenta' : 'green');
      cast = { a: ma, b: mb, strength, direction, neutralShare: pool.length / sampled };
    }
  }
  const noise = estimateNoiseSigma(rgba, width, height);
  let subject: SubjectEstimate | null = null;
  if (options.segmentation) subject = subjectFromWeights(luma, options.segmentation.weights, width, height, options.segmentation.confidence);
  if (!subject) subject = estimateDetailSubject(luma, width, height);
  return {
    width, height, p01: at(0.01), p05, p50: at(0.5), p95, p99: at(0.99), clipHigh: clipHigh / n, clipLow: clipLow / n,
    spread: clamp01(p95 - p05), noiseSigma: noise, cast, meanChroma: sampled ? chromaSum / sampled : 0, frameMean: { a: sampled ? allA / sampled : 0, b: sampled ? allB / sampled : 0 },
    tilt: estimateTilt(luma, width, height), subject,
  };
}

/**
 * Observations the pixels alone can support, each with a confidence and the rule label it resolves to. Only clearly
 * measured states are listed; anything ambiguous is left out (unknown stays unknown). Vision-model observations are
 * merged by the caller, never invented here.
 */
export function statObservations(s: FrameStats): { observation: PhotographyObservation; evidence: string }[] {
  const out: { observation: PhotographyObservation; evidence: string }[] = [];
  const add = (dimension: PhotographyObservation['dimension'], label: string, confidence: number, evidence: string) =>
    out.push({ observation: { dimension, label, confidence: Math.min(0.98, Math.max(0, confidence)) }, evidence });
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const ref = s.subject && s.subject.confidence !== 'low' ? s.subject.median : s.p50;
  if (s.clipHigh >= 0.004 && s.p99 >= 0.97) add('lighting', 'clipped highlights', 0.8 + Math.min(0.15, s.clipHigh * 5), `${pct(s.clipHigh)} of pixels are at or near white`);
  // Underexposure and low key are decided by enhanceIntent.ts (metadata, histogram shape and scene together), never by the histogram alone.
  void ref;
  if (s.p50 > 0.72 && s.p05 > 0.25) add('lighting', 'overexposure', 0.82, `median lightness ${s.p50.toFixed(2)} and no real shadows`);
  if (s.noiseSigma !== null && s.noiseSigma >= 4.5 && s.p05 < 0.2) add('lighting', 'high iso shadows', 0.8 + Math.min(0.15, (s.noiseSigma - 4.5) / 20), `noise about ${s.noiseSigma.toFixed(1)} of 255 with dark areas`);
  if (s.clipHigh >= 0.004 && s.clipLow >= 0.01 && s.spread > 0.7) add('lighting', 'high dynamic range', 0.82, `both clipped highlights (${pct(s.clipHigh)}) and crushed shadows (${pct(s.clipLow)})`);
  if (s.subject && s.subject.confidence !== 'low' && s.subject.backgroundMedian - s.subject.median > 0.2 && s.subject.coverage < 0.35)
    add('lighting', 'bright background', 0.8 + Math.min(0.15, (s.subject.backgroundMedian - s.subject.median)), `subject ${s.subject.median.toFixed(2)} against background ${s.subject.backgroundMedian.toFixed(2)}`);
  if (s.tilt && Math.abs(s.tilt.degrees) >= 0.8 && s.tilt.confidence >= 0.45) add('composition', 'horizon', 0.8 + Math.min(0.15, s.tilt.confidence * 0.2), `strong straight edges lean ${s.tilt.degrees.toFixed(1)}°`);
  if (s.subject && s.subject.confidence !== 'low' && s.subject.coverage < 0.04) add('composition', 'small subject', 0.82, `subject covers ${pct(s.subject.coverage)} of the frame`);
  if (s.subject && s.subject.touchesEdge && s.subject.confidence !== 'low') add('composition', 'subject clipping', 0.8, 'the subject touches the frame edge');
  return out;
}

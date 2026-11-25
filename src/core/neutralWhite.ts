/**
 * Neutral white balance (gap G4): the eyedropper ("this spot should be grey or white") and Auto (an estimate of the
 * light from the whole picture). Both measure the unedited, framed picture in linear light and solve for the recipe's
 * own white-balance controls (Kelvin when the RAW decoder gave an as-shot estimate, otherwise Temperature, plus Tint)
 * through `editParams`, the one function the canvas preview, the GPU shader and every export read. So what is stored
 * is an ordinary, undoable slider setting, and the preview and the export cannot disagree about it.
 *
 * Auto is an estimate (shades of grey, p = 6, on pixels that are neither clipped nor near black), never a measurement
 * of the real light: a scene that is mostly one colour can mislead it, and the panel says so.
 */
import { KELVIN_MAX, KELVIN_MIN, whiteBalanceGains, type WhiteBalanceEdit } from './asShotWhite';
import { editParams } from './photoEdits';

/** Slider limits in engine steps (V2 shows them as -100 to 100). */
const STEP_LIMIT = 2;
const WARMTH_PER_STEP = 0.08;
const TINT_PER_STEP = 0.12;
const GREEN_BALANCE = 0.2848 / 0.7152;
/** 8-bit values at or above this count as clipped and never vote. */
const CLIPPED = 250;
/** Linear luminance below this is too dark to read a colour from. */
const TOO_DARK = 0.004;

const toLinear = Array.from({ length: 256 }, (_, i) => {
  const v = i / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
});

export type Rgb = [number, number, number];

export interface NeutralBalance {
  /** Temperature in engine steps (-2 to 2); 0 when Kelvin carries the correction. */
  warmth: number;
  /** Tint in engine steps (-2 to 2). */
  tint: number;
  /** Set only for a RAW with an as-shot estimate; absent means as shot. */
  whiteBalance?: WhiteBalanceEdit;
  /** True when a slider reached its end before the colour was fully neutral. */
  limited: boolean;
}

/** Linear mean of the unclipped pixels in a square of `radius` around (x, y); null when nothing readable is there. */
export function samplePatch(pixels: Uint8ClampedArray, width: number, height: number, x: number, y: number, radius: number): Rgb | null {
  const cx = Math.round(x), cy = Math.round(y);
  if (!(cx >= 0 && cy >= 0 && cx < width && cy < height)) return null;
  const sum: Rgb = [0, 0, 0];
  let count = 0;
  for (let py = Math.max(0, cy - radius); py <= Math.min(height - 1, cy + radius); py += 1) {
    for (let px = Math.max(0, cx - radius); px <= Math.min(width - 1, cx + radius); px += 1) {
      const at = (py * width + px) * 4;
      const r = pixels[at], g = pixels[at + 1], b = pixels[at + 2];
      if (r >= CLIPPED || g >= CLIPPED || b >= CLIPPED) continue;
      sum[0] += toLinear[r]; sum[1] += toLinear[g]; sum[2] += toLinear[b];
      count += 1;
    }
  }
  if (!count) return null;
  const mean: Rgb = [sum[0] / count, sum[1] / count, sum[2] / count];
  return luminance(mean) < TOO_DARK ? null : mean;
}

/** Shades-of-grey estimate of the light's colour over the whole picture (Minkowski p = 6), in linear light. */
export function estimateIlluminant(pixels: Uint8ClampedArray, width: number, height: number): Rgb | null {
  const p = 6;
  const sum: Rgb = [0, 0, 0];
  let count = 0;
  for (let at = 0; at < width * height * 4; at += 4) {
    const r = pixels[at], g = pixels[at + 1], b = pixels[at + 2];
    if (r >= CLIPPED || g >= CLIPPED || b >= CLIPPED) continue;
    const lr = toLinear[r], lg = toLinear[g], lb = toLinear[b];
    if (luminance([lr, lg, lb]) < TOO_DARK) continue;
    sum[0] += lr ** p; sum[1] += lg ** p; sum[2] += lb ** p;
    count += 1;
  }
  // Too few readable pixels (a night sky, a blown-out window) is not an estimate.
  if (count < Math.max(16, width * height * 0.02)) return null;
  return [(sum[0] / count) ** (1 / p), (sum[1] / count) ** (1 / p), (sum[2] / count) ** (1 / p)];
}

const luminance = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const clamp = (v: number, low: number, high: number) => Math.min(high, Math.max(low, v));
const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * The white-balance setting that makes `sample` (linear RGB of the unedited picture) neutral. Other edits are left
 * as they are. With `asShotK` the blue-amber axis goes to Kelvin first and Temperature only takes what Kelvin's range
 * cannot reach; without it, Temperature does that work.
 */
export function neutralBalance(sample: Rgb, asShotK?: number): NeutralBalance {
  const [r, g, b] = sample.map((v) => Math.max(1e-6, v)) as Rgb;
  let wb: Rgb = [1, 1, 1];
  let whiteBalance: WhiteBalanceEdit | undefined;
  let kelvinReached = false;
  if (asShotK && asShotK >= KELVIN_MIN && asShotK <= KELVIN_MAX) {
    // Red over blue after the Kelvin gains rises with the target temperature, so bisect for the balance point.
    const ratio = (k: number) => { const gains = whiteBalanceGains(asShotK, k); return Math.log((r * gains[0]) / (b * gains[2])); };
    let low = KELVIN_MIN, high = KELVIN_MAX;
    let kelvin: number;
    if (ratio(low) >= 0) kelvin = low;
    else if (ratio(high) <= 0) kelvin = high;
    else {
      for (let i = 0; i < 60; i += 1) { const mid = (low + high) / 2; if (ratio(mid) < 0) low = mid; else high = mid; }
      kelvin = (low + high) / 2;
      kelvinReached = true;
    }
    kelvin = Math.round(kelvin);
    wb = whiteBalanceGains(asShotK, kelvin);
    whiteBalance = Math.abs(kelvin - asShotK) < 1 ? undefined : { asShotK, kelvin };
  }
  const red = r * wb[0], green = g * wb[1], blue = b * wb[2];
  // Kelvin is rounded to whole degrees; that leftover is not worth a Temperature setting.
  const wantWarmth = kelvinReached ? 0 : (blue - red) / (blue + red);
  const w = clamp(wantWarmth, -STEP_LIMIT * WARMTH_PER_STEP, STEP_LIMIT * WARMTH_PER_STEP);
  // Red and blue now meet at the mean H; tint lifts both (1 + t) and lowers green (1 - k t) until they meet.
  const h = (red * (1 + w) + blue * (1 - w)) / 2;
  const wantTint = (green - h) / (h + GREEN_BALANCE * green);
  const t = clamp(wantTint, -STEP_LIMIT * TINT_PER_STEP, STEP_LIMIT * TINT_PER_STEP);
  const warmth = round4(w / WARMTH_PER_STEP), tint = round4(t / TINT_PER_STEP);
  return { warmth: Object.is(warmth, -0) ? 0 : warmth, tint: Object.is(tint, -0) ? 0 : tint, ...(whiteBalance ? { whiteBalance } : {}),
    limited: Math.abs(wantWarmth - w) > 1e-6 || Math.abs(wantTint - t) > 1e-6 };
}

/** The sample after the stored edit's white balance, the way the renderer multiplies it (for checks and tests). */
export function balancedSample(sample: Rgb, balance: Pick<NeutralBalance, 'warmth' | 'tint' | 'whiteBalance'>): Rgb {
  const { channelGain } = editParams({ exposure: 0, warmth: balance.warmth, colour: 0, tint: balance.tint, whiteBalance: balance.whiteBalance });
  return [sample[0] * channelGain[0], sample[1] * channelGain[1], sample[2] * channelGain[2]];
}

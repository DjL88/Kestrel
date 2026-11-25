import { familyOf, toOklab, type ColourFamily, type Pixels } from './colourCheck';

/**
 * ColourSense: does an edit keep the main subject's colour close to the measured original?
 *
 * Compares the subject's pixels before and after an edit (same size, from the same render path): the shift in hue,
 * the change in colour strength (saturation, as OKLab chroma) and any channel that newly hits its limit (0 or 255) on
 * the subject. Pure and measured: it never guesses a colour it cannot see. When the subject is too small, or too near
 * grey for its shade to mean anything, it says so instead of judging (unknown stays unknown).
 *
 * This is the measurement and its verdict only. Whether a result is shown, downgraded or vetoed is the guardian's job.
 */

/** How far the subject's colour may move before it counts as changed. */
export const COLOUR_SENSE_TOLERANCE = {
  /** Hue shift in degrees round the OKLab colour wheel. About one tenth of the way to the next colour name. */
  hueDegrees: 10,
  /** Change in colour strength, as a fraction of the original (0.2 = 20% stronger or softer). */
  saturation: 0.2,
  /** Share of the subject where a channel newly hits 0 or 255 and loses its detail. */
  clipping: 0.01,
} as const;

/** Below this mean chroma the subject is nearly grey, and its hue is not meaningful. */
const NEAR_GREY = 0.03;
/** Below this the subject is too small to judge (share of the picture, by weight). */
const MIN_SUBJECT_SHARE = 0.005;

export type ColourSenseAspect = 'hue' | 'saturation' | 'clipping';
export type ChannelName = 'red' | 'green' | 'blue';

export type ColourSenseResult =
  | { verdict: 'unknown'; reason: 'noSubject' | 'mismatch' }
  | {
    verdict: 'kept' | 'changed';
    /** The subject's colour name before and after the edit. */
    before: ColourFamily;
    after: ColourFamily;
    /** True when the original subject is nearly grey: then saturation is judged as an absolute tint, not a ratio. */
    nearGrey: boolean;
    /** Signed hue shift in degrees, or null when the subject is nearly grey and has no meaningful hue. */
    hueShift: number | null;
    /** Change in colour strength: a ratio minus 1 (0.25 = 25% stronger), or an absolute chroma change when nearly grey. */
    saturationChange: number;
    /** Share of the subject newly clipped, per channel. */
    newlyClipped: Record<ChannelName, number>;
    /** Which aspects are outside the tolerance (empty when kept). */
    outside: ColourSenseAspect[];
  };

const valid = (pixels: Pixels) => Number.isSafeInteger(pixels.width) && Number.isSafeInteger(pixels.height)
  && pixels.width > 0 && pixels.height > 0 && pixels.width * pixels.height * 4 === pixels.data.length;

const hueDegrees = (a: number, b: number) => (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;

/** Signed smallest difference between two hues, in degrees (-180 to 180). */
export function hueDifference(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

/**
 * @param subject 0–1 per pixel, the same size as the pictures. Several subjects can be passed as one union (max).
 */
export function checkSubjectColour(before: Pixels, after: Pixels, subject: Float32Array): ColourSenseResult {
  if (!valid(before) || !valid(after) || before.width !== after.width || before.height !== after.height
    || subject.length !== before.width * before.height) return { verdict: 'unknown', reason: 'mismatch' };
  const totals = {
    weight: 0,
    before: { L: 0, a: 0, b: 0, chroma: 0 },
    after: { L: 0, a: 0, b: 0, chroma: 0 },
    clipped: { red: 0, green: 0, blue: 0 },
  };
  const atLimit = (value: number) => value === 0 || value === 255;
  for (let p = 0; p < subject.length; p += 1) {
    const raw = subject[p];
    const weight = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
    if (weight === 0) continue;
    const i = p * 4;
    const [L0, a0, b0] = toOklab(before.data[i], before.data[i + 1], before.data[i + 2]);
    const [L1, a1, b1] = toOklab(after.data[i], after.data[i + 1], after.data[i + 2]);
    totals.weight += weight;
    totals.before.L += L0 * weight; totals.before.a += a0 * weight; totals.before.b += b0 * weight; totals.before.chroma += Math.hypot(a0, b0) * weight;
    totals.after.L += L1 * weight; totals.after.a += a1 * weight; totals.after.b += b1 * weight; totals.after.chroma += Math.hypot(a1, b1) * weight;
    (['red', 'green', 'blue'] as const).forEach((channel, c) => {
      if (!atLimit(before.data[i + c]) && atLimit(after.data[i + c])) totals.clipped[channel] += weight;
    });
  }
  if (totals.weight < MIN_SUBJECT_SHARE * subject.length || totals.weight === 0) return { verdict: 'unknown', reason: 'noSubject' };

  const mean = (side: typeof totals.before) => ({ L: side.L / totals.weight, a: side.a / totals.weight, b: side.b / totals.weight, chroma: side.chroma / totals.weight });
  const was = mean(totals.before);
  const now = mean(totals.after);
  const greyBefore = was.chroma < NEAR_GREY;
  const hueShift = greyBefore || now.chroma < NEAR_GREY ? null
    : hueDifference(hueDegrees(was.a, was.b), hueDegrees(now.a, now.b));
  const saturationChange = greyBefore ? now.chroma - was.chroma : now.chroma / was.chroma - 1;
  const newlyClipped = {
    red: totals.clipped.red / totals.weight,
    green: totals.clipped.green / totals.weight,
    blue: totals.clipped.blue / totals.weight,
  };

  const outside: ColourSenseAspect[] = [];
  if (hueShift !== null && Math.abs(hueShift) > COLOUR_SENSE_TOLERANCE.hueDegrees) outside.push('hue');
  // Near grey, a ratio is meaningless: judge the absolute change in chroma against the grey threshold instead.
  if (greyBefore ? Math.abs(saturationChange) > NEAR_GREY : Math.abs(saturationChange) > COLOUR_SENSE_TOLERANCE.saturation) outside.push('saturation');
  if (Object.values(newlyClipped).some((share) => share >= COLOUR_SENSE_TOLERANCE.clipping)) outside.push('clipping');

  return {
    verdict: outside.length ? 'changed' : 'kept',
    before: familyOf(was.L, was.a, was.b),
    after: familyOf(now.L, now.a, now.b),
    nearGrey: greyBefore,
    hueShift,
    saturationChange,
    newlyClipped,
    outside,
  };
}

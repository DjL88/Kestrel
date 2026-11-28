import { toOklab, type CastDirection, type ColourFinding, type ColourReport } from './colourCheck';
import { renderRecipePreview } from './naturalAuto';
import { DEFAULT_EDIT, type PhotoEdit } from './photoEdits';

/**
 * Advice about a colour cast that RESOLVES. The unedited preview's neutral areas (grey, white, water, sky: never the
 * subject) are measured once at a ladder of Temperature and Tint steps, using the real render. Afterwards, for ANY
 * current recipe, the cast that would remain is read off that measured ladder (a re-measure with no pixels needed), the
 * correction that actually brings it under the visible threshold is worked out (not a fixed amount), and the message
 * is cleared when it is satisfied. When no reachable correction helps, it says so plainly instead of offering a nudge
 * that changes nothing. Warm light that is expected (golden hour) is called natural. Pure: nothing here edits a photo.
 */

/** The same visibility threshold as the colour check's own cast finding. */
export const CAST_VISIBLE = 0.008;
const CLEAR = 0.018;
/** Temperature / Tint steps measured (PhotoEdit units, 50 slider points each). */
const STEPS = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];
export const SLIDER_PER_STEP = 50;

interface Vec { a: number; b: number }
export interface CastCurve {
  /** Share of the picture the neutral reference covers; below 5% no cast is claimed. */
  share: number;
  /** Mean a/b of the neutral reference at each step, Temperature then Tint. */
  warmth: Vec[];
  tint: Vec[];
  /** Golden or blue hour: a warm lean is the light, not a fault. */
  expectWarm: boolean;
}

function neutralVec(data: Uint8ClampedArray, width: number, height: number, subject?: Float32Array): { v: Vec; share: number } {
  let a = 0, b = 0, count = 0;
  const n = width * height;
  for (let p = 0; p < n; p += 1) {
    if (subject && (subject[p] ?? 0) > 0.35) continue;
    const [L, A, B] = toOklab(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]);
    if (Math.hypot(A, B) < 0.05 && L > 0.25 && L < 0.92) { a += A; b += B; count += 1; }
  }
  return { v: count ? { a: a / count, b: b / count } : { a: 0, b: 0 }, share: count / Math.max(1, n) };
}

export function measureCastCurve(input: { pixels: Uint8ClampedArray; width: number; height: number; subject?: Float32Array; expectWarm?: boolean }): CastCurve | null {
  const { pixels, width, height, subject } = input;
  if (!(width > 0 && height > 0) || pixels.length !== width * height * 4) return null;
  const at = (edit: Partial<PhotoEdit>) => neutralVec(renderRecipePreview(pixels, width, height, { ...DEFAULT_EDIT, ...edit }), width, height, subject);
  const base = at({});
  if (base.share < 0.05) return null;
  return { share: base.share, expectWarm: Boolean(input.expectWarm),
    warmth: STEPS.map((x) => at({ warmth: x }).v), tint: STEPS.map((x) => at({ tint: x }).v) };
}

const lerp = (curve: Vec[], x: number): Vec => {
  const t = Math.min(1, Math.max(-1, x));
  const f = (t + 1) / 0.25;
  const i = Math.min(STEPS.length - 2, Math.floor(f));
  const k = f - i;
  return { a: curve[i].a * (1 - k) + curve[i + 1].a * k, b: curve[i].b * (1 - k) + curve[i + 1].b * k };
};

/** The neutral lean (a, b) the picture would have with this Temperature and Tint, read off the measured ladder. */
export function castAt(curve: CastCurve, warmth: number, tint: number): Vec {
  const w = lerp(curve.warmth, warmth), t = lerp(curve.tint, tint);
  const w0 = curve.warmth[4], t0 = curve.tint[4];
  // Both axes' shifts add to the unedited lean (small shifts: the ladders are measured one axis at a time).
  return { a: w0.a + (w.a - w0.a) + (t.a - t0.a), b: w0.b + (w.b - w0.b) + (t.b - t0.b) };
}

const size = (v: Vec) => Math.hypot(v.a, v.b);
const hue = (v: Vec) => ((Math.atan2(v.b, v.a) * 180) / Math.PI + 360) % 360;
function directionOf(v: Vec): CastDirection {
  const h = hue(v);
  return h >= 30 && h < 120 ? 'warm' : h >= 120 && h < 180 ? 'green' : h >= 180 && h < 300 ? 'cool' : 'magenta';
}

/**
 * The cast finding for the CURRENT recipe, or null when it is cleared (inside the visible threshold). Carries what to
 * do: a measured `fixDelta` (slider points to add), or `left` when no reachable change brings it under the threshold
 * (said plainly, with no useless nudge), or `natural` for expected warm light.
 */
export function castFindingFor(curve: CastCurve, edit: Pick<PhotoEdit, 'warmth' | 'tint'> | undefined): ColourFinding | null {
  const warmth = edit?.warmth ?? 0, tint = edit?.tint ?? 0;
  const now = castAt(curve, warmth, tint);
  const current = size(now);
  if (current < CAST_VISIBLE) return null;
  const direction = directionOf(now);
  const amount = current >= CLEAR ? 'clear' : 'slight';
  if (curve.expectWarm && direction === 'warm') return { id: 'cast', severity: 'tip', direction, amount, size: current, status: 'natural' };
  const axis = direction === 'warm' || direction === 'cool' ? 'warmth' : 'tint';
  // The smallest move along the axis (within one full step either way, and the slider's own range) that clears it.
  let best: { delta: number; remaining: number } | null = null;
  for (let step = 1; step <= 100; step += 1) {
    for (const sign of [-1, 1]) {
      const x = (axis === 'warmth' ? warmth : tint) + sign * step * 0.01 * SLIDER_PER_STEP / SLIDER_PER_STEP;
      if (Math.abs(x) > 1) continue;
      const v = axis === 'warmth' ? castAt(curve, x, tint) : castAt(curve, warmth, x);
      const remaining = size(v);
      if (!best || remaining < best.remaining - 1e-9 || (Math.abs(remaining - best.remaining) < 1e-9 && Math.abs(step) < Math.abs(best.delta))) best = { delta: sign * step * 0.01, remaining };
      if (remaining < CAST_VISIBLE) return { id: 'cast', severity: 'tip', direction, amount, size: current, status: 'fixable',
        fixDelta: Math.round(sign * step * 0.01 * SLIDER_PER_STEP) || sign };
    }
  }
  return { id: 'cast', severity: 'tip', direction, amount, size: current, status: 'left' };
}

/** The colour report with its cast finding re-measured for the recipe the photo has now (cleared, fixable, left or natural). */
export function recastReport(report: ColourReport, curve: CastCurve | null | undefined, edit: Pick<PhotoEdit, 'warmth' | 'tint'> | undefined): ColourReport {
  if (!curve) return report;
  const findings = report.findings.filter((finding) => finding.id !== 'cast');
  const cast = castFindingFor(curve, edit);
  return { ...report, findings: cast ? [...findings, cast] : findings };
}

/**
 * Pure helpers for the V2 tone-curve editor: adding, moving and removing points while keeping the curve valid for the
 * engine (2 to 16 points, inputs strictly increasing, everything inside 0 to 1). The engine's own monotone cubic draws
 * the line, so what the graph shows is the curve the pixels get.
 */
import { CURVE_LUT_SIZE, curveLut, MAX_CURVE_POINTS } from '../../../core/curveMixer';

export type UiCurvePoint = [number, number];
/** Points closer than this on the input axis are refused, so a point can never pass its neighbour. */
export const MIN_GAP = 0.02;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round = (v: number) => Math.round(v * 10000) / 10000;

export const CURVE_PRESETS = {
  linear: [[0, 0], [1, 1]],
  gentle: [[0, 0], [0.25, 0.21], [0.75, 0.79], [1, 1]],
  strong: [[0, 0], [0.25, 0.16], [0.75, 0.85], [1, 1]],
  faded: [[0, 0.08], [0.3, 0.3], [1, 1]],
} satisfies Record<string, UiCurvePoint[]>;
export type CurvePresetId = keyof typeof CURVE_PRESETS;

/** Insert a point where the person clicked; null when there is no room (too close to another point, or 16 already). */
export function addCurvePoint(points: UiCurvePoint[], at: UiCurvePoint): { points: UiCurvePoint[]; index: number } | null {
  if (points.length >= MAX_CURVE_POINTS) return null;
  const x = round(clamp01(at[0]));
  if (points.some(([px]) => Math.abs(px - x) < MIN_GAP)) return null;
  const index = points.findIndex(([px]) => px > x);
  const at2: UiCurvePoint = [x, round(clamp01(at[1]))];
  if (index === -1) return { points: [...points, at2], index: points.length };
  return { points: [...points.slice(0, index), at2, ...points.slice(index)], index };
}

/** Move a point, keeping it between its neighbours. The two end points can move up and down and inwards. */
export function moveCurvePoint(points: UiCurvePoint[], index: number, to: UiCurvePoint): UiCurvePoint[] {
  const low = index === 0 ? 0 : points[index - 1][0] + MIN_GAP;
  const high = index === points.length - 1 ? 1 : points[index + 1][0] - MIN_GAP;
  const x = round(Math.min(high, Math.max(low, clamp01(to[0]))));
  const next = points.map((p) => [p[0], p[1]] as UiCurvePoint);
  next[index] = [x, round(clamp01(to[1]))];
  return next;
}

/** Remove a point; the curve always keeps at least two. */
export function removeCurvePoint(points: UiCurvePoint[], index: number): UiCurvePoint[] | null {
  if (points.length <= 2) return null;
  return points.filter((_, i) => i !== index);
}

/** SVG path of the engine's own curve, so the graph and the pixels agree. */
export function curvePath(points: UiCurvePoint[], size: number): string {
  const lut = curveLut(points);
  const step = 8;
  const parts: string[] = [];
  for (let k = 0; k < CURVE_LUT_SIZE; k += step) parts.push(`${(k / (CURVE_LUT_SIZE - 1)) * size},${(1 - lut[k]) * size}`);
  parts.push(`${size},${(1 - lut[CURVE_LUT_SIZE - 1]) * size}`);
  return `M${parts.join(' L')}`;
}

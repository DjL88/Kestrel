/**
 * Advanced colour controls (owner request, 25 Nov 2026): three-way colour grading and per-channel tone curves.
 * Pure maths shared by the CPU path (photoEdits.ts tonePixel), the 16-bit export and the GPU shader (webglEdit.ts),
 * so preview and export cannot drift apart. Malformed saved values are ignored by renderers and refused by the
 * 16-bit export, never guessed at.
 */
import { applyCurveLut, curveLut, CURVE_LUT_SIZE, isNeutralCurve, validCurve, type CurvePoint } from './curveMixer';

/** One tonal range's tint: hue in degrees (0 to 360) and strength (0 to 1). */
export type GradeTint = [hue: number, amount: number];

export interface ColourGrade {
  shadows: GradeTint;
  midtones: GradeTint;
  highlights: GradeTint;
  /** Moves the split between shadows and highlights: -1 favours highlights, 1 favours shadows. */
  balance: number;
}

export type ChannelCurves = Partial<Record<'red' | 'green' | 'blue', CurvePoint[]>>;
export const CURVE_CHANNELS = ['red', 'green', 'blue'] as const;

/** Largest shift of one channel, in display values, at full strength. Kept moderate so a full wheel is a strong but not garish tint. */
export const GRADE_STRENGTH = 0.2;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const validTint = (value: unknown): value is GradeTint =>
  Array.isArray(value) && value.length === 2 && finite(value[0]) && value[0] >= 0 && value[0] <= 360 && finite(value[1]) && value[1] >= 0 && value[1] <= 1;

export function validGrade(value: unknown): value is ColourGrade {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const grade = value as Record<string, unknown>;
  if (Object.keys(grade).some((key) => !['shadows', 'midtones', 'highlights', 'balance'].includes(key))) return false;
  return validTint(grade.shadows) && validTint(grade.midtones) && validTint(grade.highlights) && finite(grade.balance) && grade.balance >= -1 && grade.balance <= 1;
}

/** Absent, no strength in any range, or malformed. */
export function isNeutralGrade(grade: unknown): boolean {
  return !validGrade(grade) || (grade.shadows[1] === 0 && grade.midtones[1] === 0 && grade.highlights[1] === 0);
}

export function validChannelCurves(value: unknown): value is ChannelCurves {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const curves = value as Record<string, unknown>;
  return Object.keys(curves).every((key) => (CURVE_CHANNELS as readonly string[]).includes(key) && validCurve(curves[key]));
}

/** Absent, all straight, or malformed. */
export function isNeutralChannelCurves(value: unknown): boolean {
  return !validChannelCurves(value) || CURVE_CHANNELS.every((channel) => value[channel] === undefined || isNeutralCurve(value[channel]));
}

/** A fully saturated colour of this hue, minus its own luma, so adding it shifts colour without shifting brightness. */
function hueOffset(hue: number): [number, number, number] {
  const h = (((hue % 360) + 360) % 360) / 60;
  const x = 1 - Math.abs((h % 2) - 1);
  const rgb: [number, number, number] = h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x];
  const luma = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return [rgb[0] - luma, rgb[1] - luma, rgb[2] - luma];
}

/** Shader-ready constants: shadow, midtone and highlight offsets (three each), then the pivot. */
export function gradeParams(grade: ColourGrade): Float32Array {
  const params = new Float32Array(10);
  [grade.shadows, grade.midtones, grade.highlights].forEach(([hue, amount], range) => {
    const offset = hueOffset(hue);
    for (let c = 0; c < 3; c += 1) params[range * 3 + c] = offset[c] * amount * GRADE_STRENGTH;
  });
  params[9] = 0.5 + grade.balance * 0.3;
  return params;
}

const smoothstep = (low: number, high: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - low) / (high - low)));
  return t * t * (3 - 2 * t);
};

/** Grade display-encoded values (0 to 1) in place. The GPU shader mirrors this exactly. */
export function gradePixel(out: Float32Array, params: Float32Array): void {
  const luma = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2];
  const pivot = params[9];
  const shadow = 1 - smoothstep(0, pivot, luma);
  const highlight = smoothstep(pivot, 1, luma);
  const midtone = Math.max(0, 1 - shadow - highlight);
  for (let c = 0; c < 3; c += 1) {
    out[c] = Math.min(1, Math.max(0, out[c] + shadow * params[c] + midtone * params[3 + c] + highlight * params[6 + c]));
  }
}

/**
 * The master curve followed by each channel's own curve, sampled into one table per channel. Null when no channel
 * curve is set, so photos without one keep the single master table exactly as before.
 */
export function channelCurveLuts(master: CurvePoint[] | undefined, channels: ChannelCurves | undefined): [Float32Array, Float32Array, Float32Array] | null {
  if (isNeutralChannelCurves(channels)) return null;
  const masterLut = !isNeutralCurve(master) ? curveLut(master!) : null;
  return CURVE_CHANNELS.map((channel) => {
    const own = channels![channel] && !isNeutralCurve(channels![channel]) ? curveLut(channels![channel]!) : null;
    const lut = new Float32Array(CURVE_LUT_SIZE);
    for (let k = 0; k < CURVE_LUT_SIZE; k += 1) {
      const x = k / (CURVE_LUT_SIZE - 1);
      const after = masterLut ? masterLut[k] : x;
      lut[k] = own ? applyCurveLut(after, own) : after;
    }
    return lut;
  }) as [Float32Array, Float32Array, Float32Array];
}

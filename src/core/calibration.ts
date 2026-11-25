/**
 * Camera calibration (advanced controls, 25 Nov 2026): shift the hue and saturation of the red, green and blue
 * primaries. Built as one 3 × 3 matrix on linear light that keeps neutral greys exactly neutral, applied right after
 * white balance by the CPU path (photoEdits.ts tonePixel, so the 16-bit export too) and the GPU shader alike.
 */
export type PrimaryShift = [hue: number, saturation: number];
export interface Calibration { red: PrimaryShift; green: PrimaryShift; blue: PrimaryShift }
export const PRIMARIES = ['red', 'green', 'blue'] as const;

/** Largest hue turn of one primary, in degrees, and the largest saturation change, at the ends of the sliders. */
export const CALIBRATION_HUE_DEGREES = 30;
export const CALIBRATION_SATURATION = 0.6;
const LUMA = [0.2126, 0.7152, 0.0722] as const;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const validShift = (value: unknown): value is PrimaryShift =>
  Array.isArray(value) && value.length === 2 && value.every((v) => finite(v) && v >= -1 && v <= 1);

export function validCalibration(value: unknown): value is Calibration {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return Object.keys(entry).every((key) => (PRIMARIES as readonly string[]).includes(key)) && PRIMARIES.every((key) => validShift(entry[key]));
}

export function isNeutralCalibration(value: unknown): boolean {
  return !validCalibration(value) || PRIMARIES.every((key) => value[key][0] === 0 && value[key][1] === 0);
}

/**
 * Row-major matrix. Each primary is turned about the grey axis (positive turns red towards yellow, green towards aqua
 * and blue towards magenta) and its colourfulness scaled, keeping its own luma; the result is then corrected so that
 * white maps to white.
 */
export function calibrationMatrix(calibration: Calibration): Float32Array {
  const columns = PRIMARIES.map((key, p) => {
    const [hue, saturation] = calibration[key];
    const angle = (hue * CALIBRATION_HUE_DEGREES * Math.PI) / 180;
    const cos = Math.cos(angle), sin = Math.sin(angle), k = 1 / Math.sqrt(3);
    const chroma = [0, 1, 2].map((c) => (c === p ? 1 : 0) - LUMA[p]);
    // Rodrigues rotation about (1,1,1)/√3: the grey component of `chroma` is ~0, so the axial term only corrects rounding.
    const sum = (chroma[0] + chroma[1] + chroma[2]) / 3;
    const cross = [chroma[2] - chroma[1], chroma[0] - chroma[2], chroma[1] - chroma[0]].map((v) => v * k);
    const scale = 1 + saturation * CALIBRATION_SATURATION;
    return [0, 1, 2].map((c) => LUMA[p] + scale * (chroma[c] * cos + cross[c] * sin + sum * (1 - cos)));
  });
  const m = new Float32Array(9);
  for (let r = 0; r < 3; r += 1) {
    const rowSum = columns[0][r] + columns[1][r] + columns[2][r];
    for (let c = 0; c < 3; c += 1) m[r * 3 + c] = columns[c][r] + (1 - rowSum) * LUMA[c];
  }
  return m;
}

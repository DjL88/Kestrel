/** ISO 216 paper sizes in millimetres. Physical dimensions become output
 * pixels only with an explicitly chosen resolution. PPI does not modify originals. */
export type DimensionUnit = 'px' | 'mm' | 'cm' | 'in';
export type PaperPreset = 'custom' | 'A7' | 'A6' | 'A5' | 'A4' | 'A3' | 'A2' | 'A1';
export type PaperOrientation = 'portrait' | 'landscape';
export interface PixelDimensions { width: number; height: number }
export const PAPER_MM: Record<Exclude<PaperPreset, 'custom'>, readonly [number, number]> = {
  A7: [74, 105], A6: [105, 148], A5: [148, 210],
  A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841],
};
const MAX_PIXEL_SIDE = 20000;
const MM_PER_INCH = 25.4;

export function paperDimensions(preset: Exclude<PaperPreset, 'custom'>, orientation: PaperOrientation): PixelDimensions {
  const [short, long] = PAPER_MM[preset];
  return orientation === 'portrait' ? { width: short, height: long } : { width: long, height: short };
}

/**
 * Returns undefined instead of silently clamping the requested size.
 * A file with 1200 PPI metadata alone does not magically gain resolution.
 */
export function dimensionPixels(width: number, height: number, unit: DimensionUnit, ppi: number): PixelDimensions | undefined {
  if (![width, height].every((n) => Number.isFinite(n) && n > 0) ||
      !Number.isFinite(ppi) || ppi < 1 || ppi > 2400) return undefined;
  const factor = unit === 'px' ? 1 : unit === 'mm' ? ppi / MM_PER_INCH : unit === 'cm' ? ppi / 2.54 : unit === 'in' ? ppi : NaN;
  if (!Number.isFinite(factor)) return undefined;
  const outputWidth = Math.round(width * factor);
  const outputHeight = Math.round(height * factor);
  if (![outputWidth, outputHeight].every((n) => Number.isSafeInteger(n) && n >= 100 && n <= MAX_PIXEL_SIDE)) return undefined;
  if (unit === 'px' && (!Number.isInteger(width) || !Number.isInteger(height))) return undefined;
  return { width: outputWidth, height: outputHeight };
}

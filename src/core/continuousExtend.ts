/** Geometry only: one continuous photograph, with guides at export section boundaries. */
export const MAX_EXTEND_SECTIONS = 5;
export type ExtendCount = 1 | 2 | 3 | 4 | 5;

/** Old projects stored a split toggle; true meant two sections, false one. */
export function readExtendCount(saved: { extendCount?: unknown; splitFrames?: unknown }): ExtendCount {
  const count = saved.extendCount;
  if (typeof count === 'number' && Number.isInteger(count) && count >= 1 && count <= MAX_EXTEND_SECTIONS) {
    return count as ExtendCount;
  }
  return saved.splitFrames === true ? 2 : 1;
}

export function nextExtendCount(count: ExtendCount): ExtendCount {
  return Math.min(MAX_EXTEND_SECTIONS, count + 1) as ExtendCount;
}

export interface ExtendSection { index: number; x: number; y: 0; width: number; height: number }

/**
 * Plan equal consecutive sections without manufacturing pixels. Callers must not export
 * when canExportAtRequestedSize is false; show the warning and offer an explicit
 * smaller output choice instead. The original image and crop recipe are untouched.
 */
export function planContinuousExtend(
  sectionWidth: number, sectionHeight: number, count: ExtendCount,
  sourceWidth: number, sourceHeight: number,
) {
  if (![sectionWidth, sectionHeight, sourceWidth, sourceHeight].every(v => Number.isSafeInteger(v) && v > 0)) {
    throw new RangeError('Continuous format dimensions must be positive whole pixels');
  }
  if (!Number.isInteger(count) || count < 1 || count > MAX_EXTEND_SECTIONS) {
    throw new RangeError('Continuous format must contain 1 to 5 sections');
  }
  const totalWidth = sectionWidth * count;
  if (!Number.isSafeInteger(totalWidth)) throw new RangeError('Continuous format exceeds safe dimensions');
  const sections: ExtendSection[] = Array.from({ length: count }, (_, index) => ({
    index: index + 1, x: index * sectionWidth, y: 0, width: sectionWidth, height: sectionHeight,
  }));
  const canExportAtRequestedSize = sourceWidth >= totalWidth && sourceHeight >= sectionHeight;
  return {
    totalWidth, totalHeight: sectionHeight, sections,
    canExportAtRequestedSize,
    maximumNativeScale: Math.min(1, sourceWidth / totalWidth, sourceHeight / sectionHeight),
    warning: canExportAtRequestedSize ? null : 'The original does not have enough pixels for this panorama at the chosen size. Choose a smaller export size; InFlight will not upscale it.',
  };
}

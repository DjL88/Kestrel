/** Geometry shared by the one-render, consecutive-frame export.
 * All panels sample the SAME completed canvas, so seam pixels are adjacent.
 * This is deliberately bounded to 2 panels until the editor stores a count. */
export interface ContinuousSection { index: number; x: number; y: 0; width: number; height: number }
export interface ContinuousExportLayout {
  width: number; height: number; sectionWidth: number; sections: ContinuousSection[];
}
export function continuousExportLayout(sectionWidth: number, height: number, count: 1 | 2): ContinuousExportLayout {
  if (![sectionWidth, height].every(v => Number.isSafeInteger(v) && v > 0 && v <= 20000) ||
      (count !== 1 && count !== 2) || sectionWidth * count > 20000) {
    throw new RangeError('Split output must have one or two positive sections within the export canvas limit.');
  }
  const width = sectionWidth * count;
  return {
    width, height, sectionWidth,
    sections: Array.from({ length: count }, (_, i) => ({ index: i + 1, x: i * sectionWidth, y: 0 as const, width: sectionWidth, height })),
  };
}
/** If an output must shrink to fit source detail, shrink the combined canvas
 * together and divide it exactly. Never render panels at different scales. */
export function cappedContinuousLayout(combinedWidth: number, height: number, count: 1 | 2): ContinuousExportLayout {
  const sectionWidth = Math.floor(combinedWidth / count);
  return continuousExportLayout(sectionWidth, height, count);
}

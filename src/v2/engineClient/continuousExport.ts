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

/** Keep ordering visible on disk while retaining the requested JPEG/PNG extension. */
export function numberedSectionFilename(filename: string, section: number, count: 1 | 2): string {
  if (count === 1) return filename;
  if (!Number.isInteger(section) || section < 1 || section > count || !/\\.[a-zA-Z0-9]{2,5}$/.test(filename)) {
    throw new RangeError('Split output requires a numbered section and a recognised filename extension.');
  }
  return filename.replace(/(\\.[^.]+)$/, `-${String(section).padStart(2, '0')}-of-${String(count).padStart(2, '0')}$1`);
}

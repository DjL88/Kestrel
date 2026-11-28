import { plural } from '../../../core/locale';

/**
 * Collage export choices (preview): export size, print resolution, the pixels of each window, and RAW photos in a
 * collage. British English, the source for every translation.
 */
export const source = {
  size: "Export size",
  standard: (w: number, h: number) => `Standard · ${w} × ${h} px`,
  double: (w: number, h: number) => `Twice the size · ${w} × ${h} px`,
  custom: "Custom long edge",
  customEdge: "Long edge in pixels",
  customSize: (w: number, h: number) => `${w} × ${h} px`,
  dpi: "Print resolution",
  dpiOption: (n: number) => `${n} DPI`,
  pdfNote: (dpi: number) => `RGB photo-lab PDF, ${dpi} PPI, 3 mm bleed and trim boxes. Not CMYK or certified PDF/X.`,
  windows: "Photographs in each window",
  window: (page: number, window: number, filename: string) => window === 0 ? `Page ${page}, background: ${filename}` : `Page ${page}, window ${window}: ${filename}`,
  pixels: (sw: number, sh: number, ww: number, wh: number) => `${sw} × ${sh} px in the photo, shown at ${ww} × ${wh} px`,
  unknown: (ww: number, wh: number) => `Shown at ${ww} × ${wh} px. The photo's size is checked when the collage is exported.`,
  enlarged: (percent: number) => `Enlarged to ${percent}%, so it will look softer.`,
  sharp: "Enough pixels for this size.",
  ppi: (ppi: number) => `${ppi} pixels per inch.`,
  lowPpi: (ppi: number, dpi: number) => `${ppi} pixels per inch, below the ${dpi} DPI chosen, so it will print softer.`,
  lowSummary: (n: number) => plural(n, {
    one: `${n} window has fewer pixels than this size needs. Choose a smaller size, or export anyway and it will look softer.`,
    other: `${n} windows have fewer pixels than this size needs. Choose a smaller size, or export anyway and they will look softer.`,
  }),
  exportAnyway: (n: number) => plural(n, { one: `Export anyway (${n} softer window)`, other: `Export anyway (${n} softer windows)` }),
  rawNote: "RAW photos are developed by InFlight from their sensor data, as in the editor; embedded camera previews are never used. HEIF originals are not supported in a collage yet.",
  heif: (filename: string) => `${filename} is a HEIF file. A collage cannot verify its full-resolution pixels yet, so nothing was put in its place.`,
  embedded: (filename: string) => `${filename} has no picture developed from its sensor data, and an embedded camera preview is never used in a collage.`,
  done: "Collage exported. Your originals are unchanged.",
  doneSoft: (n: number) => plural(n, {
    one: `Collage exported. ${n} window was enlarged or below the print resolution, as shown before export. Your originals are unchanged.`,
    other: `Collage exported. ${n} windows were enlarged or below the print resolution, as shown before export. Your originals are unchanged.`,
  }),
};

import { COLLAGE_FORMATS, type CollageFormat } from './collage';
/** Page geometry for a future print PDF renderer. Never turn a CSS/screen preview into print evidence. */
export interface PrintPagePlan {
  trimWidthMm: number; trimHeightMm: number; bleedMm: number;
  mediaWidthMm: number; mediaHeightMm: number;
  targetPixels: { width: number; height: number }; dpi: number;
  trimBoxPt: [number, number, number, number];
  mediaBoxPt: [number, number, number, number];
}
export function planCollagePrint(format: CollageFormat, dpi = 300, bleedMm = 3): PrintPagePlan {
  const page = COLLAGE_FORMATS[format];
  if (page.unit !== 'mm') throw new Error('Choose a physical paper size before exporting a print PDF.');
  if (!Number.isInteger(dpi) || dpi < 240 || dpi > 600) throw new Error('Print resolution must be 240–600 DPI.');
  if (!Number.isFinite(bleedMm) || bleedMm < 0 || bleedMm > 10) throw new Error('Bleed must be between 0 and 10 mm.');
  const width = page.width + bleedMm * 2;
  const height = page.height + bleedMm * 2;
  const toPt = (mm: number) => mm * 72 / 25.4;
  const toPx = (mm: number) => Math.ceil(mm * dpi / 25.4);
  return {
    trimWidthMm: page.width, trimHeightMm: page.height, bleedMm,
    mediaWidthMm: width, mediaHeightMm: height,
    targetPixels: { width: toPx(width), height: toPx(height) }, dpi,
    trimBoxPt: [toPt(bleedMm), toPt(bleedMm), toPt(width - bleedMm), toPt(height - bleedMm)],
    mediaBoxPt: [0, 0, toPt(width), toPt(height)],
  };
}
/** Never silently upscale low-resolution photographs into a purported print-ready file. */
export function printSlotResolution(sourcePixels: { width: number; height: number }, slotMm: { width: number; height: number }) {
  if (sourcePixels.width <= 0 || sourcePixels.height <= 0 || slotMm.width <= 0 || slotMm.height <= 0) return 0;
  const coverScale = Math.max(slotMm.width / sourcePixels.width, slotMm.height / sourcePixels.height);
  return 25.4 / coverScale;
}
export function printResolutionMessage(ppi: number, target = 300): string | null {
  if (ppi >= target) return null;
  return `This window has only ${Math.floor(ppi)} genuine pixels per inch at the selected print size. Choose a smaller window or higher-resolution original; InFlight will not silently upscale it to ${target} PPI.`;
}

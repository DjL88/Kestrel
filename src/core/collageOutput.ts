import { COLLAGE_FORMATS, type CollageDocument, type CollageFormat, type CollagePage } from './collage';
import { planCollagePrint, printSlotResolution } from './collagePrint';

/**
 * How big a collage is exported, and how many genuine photograph pixels each window has at that size. Shared by the
 * export dialog (a check before anything is rendered) and the page renderer (the same check on the decoded pixels), so
 * InFlight never enlarges or shrinks a window without saying so.
 */

/** Social pages: the format's own pixel size, twice it, or a chosen long edge. */
export type CollageScale = { kind: 'x1' } | { kind: 'x2' } | { kind: 'custom'; longEdge: number };
/** Print resolutions offered for an album PDF. */
export const PRINT_DPI_CHOICES = [240, 300, 360] as const;
export type PrintDpi = (typeof PRINT_DPI_CHOICES)[number];
export const DEFAULT_PRINT_DPI: PrintDpi = 300;
/** The custom long edge is kept between these, in pixels. */
export const CUSTOM_EDGE_MIN = 320;
export const CUSTOM_EDGE_MAX = 8192;

export const isPrintDpi = (value: unknown): value is PrintDpi => PRINT_DPI_CHOICES.includes(value as PrintDpi);

/** The custom long edge held inside its range, or null when it is not a usable number. */
export function customLongEdge(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.min(CUSTOM_EDGE_MAX, Math.max(CUSTOM_EDGE_MIN, Math.round(value)));
}

/** The pixel size of a social page at a scale. The page keeps its shape; sizes are whole pixels. */
export function collageSocialSize(format: CollageFormat, scale: CollageScale = { kind: 'x1' }): { width: number; height: number } {
  const page = COLLAGE_FORMATS[format];
  if (page.unit !== 'px') throw new Error('Choose a social canvas size for JPEG or PNG.');
  const long = Math.max(page.width, page.height);
  const target = scale.kind === 'x2' ? long * 2 : scale.kind === 'custom' ? customLongEdge(scale.longEdge) ?? long : long;
  const factor = target / long;
  return { width: Math.round(page.width * factor), height: Math.round(page.height * factor) };
}

/** The size a photo can give: its pixels after its own crop and turn, and its file name for the message. */
export interface CollageSourceSize { width: number; height: number; filename: string }

export interface CollageWindowCheck {
  /** 1-based page number in the document, and 1-based window number on the page; 0 is the page's background photograph. */
  page: number;
  window: number;
  photoId: string;
  filename: string;
  /** The window's size in output pixels. */
  windowPx: { width: number; height: number };
  /** The photograph's pixels, or null when its size is not known before it is decoded. */
  sourcePx: { width: number; height: number } | null;
  /** Social pages: how much the photograph is enlarged to fill its window (1.5 means 150%); 1 or less is not enlarged. */
  enlargement: number | null;
  /** Album pages: genuine pixels per inch at the printed size. */
  ppi: number | null;
  /** True when the window is enlarged (social) or below the chosen print resolution (album). */
  low: boolean;
}

export type CollageOutput = { kind: 'social'; scale: CollageScale } | { kind: 'print'; dpi: PrintDpi };

/** Output pixel size of the whole page, and of its trimmed area (the page without bleed). */
export function collagePageGeometry(doc: Pick<CollageDocument, 'format'>, output: CollageOutput) {
  if (output.kind === 'print') {
    const plan = planCollagePrint(doc.format, output.dpi, 3);
    const { width, height } = plan.targetPixels;
    const bx = width * plan.bleedMm / plan.mediaWidthMm, by = height * plan.bleedMm / plan.mediaHeightMm;
    return { width, height, bleedX: bx, bleedY: by, trimWidth: width - 2 * bx, trimHeight: height - 2 * by, plan };
  }
  const { width, height } = collageSocialSize(doc.format, output.scale);
  return { width, height, bleedX: 0, bleedY: 0, trimWidth: width, trimHeight: height, plan: null };
}

/** One window's output size, from its share of the page less the gap (the renderer's own geometry). */
export function windowPixels(slot: Pick<CollagePage['slots'][number], 'width' | 'height'>, gap: number, trimWidth: number, trimHeight: number) {
  return { width: trimWidth * Math.max(1, slot.width - gap) / 100, height: trimHeight * Math.max(1, slot.height - gap) / 100 };
}

/**
 * Measure one window: how much its photograph is enlarged (social) or its genuine print resolution (album). The
 * window's own zoom uses a smaller part of the photograph, so it counts against the pixels. Returns null fields when the
 * photograph's size is unknown.
 */
export function measureWindow(
  source: { width: number; height: number } | null, windowPx: { width: number; height: number }, zoom: number,
  output: CollageOutput, trimMm?: { width: number; height: number }, trimPx?: { width: number; height: number },
): Pick<CollageWindowCheck, 'enlargement' | 'ppi' | 'low'> {
  if (!source || source.width <= 0 || source.height <= 0) return { enlargement: null, ppi: null, low: false };
  const z = Math.max(1, Number.isFinite(zoom) ? zoom : 1);
  if (output.kind === 'print' && trimMm && trimPx) {
    const mm = { width: windowPx.width / trimPx.width * trimMm.width, height: windowPx.height / trimPx.height * trimMm.height };
    const ppi = printSlotResolution(source, mm) / z;
    return { enlargement: null, ppi: Math.floor(ppi), low: ppi < output.dpi };
  }
  const enlargement = Math.max(windowPx.width / source.width, windowPx.height / source.height) * z;
  return { enlargement: Math.round(enlargement * 100) / 100, ppi: null, low: enlargement > 1.001 };
}

/**
 * Check every window on the chosen pages before export. `sizeOf` gives a photograph's framed size, or null when it is
 * unknown (it is then checked again once decoded). Windows without a photograph are left out.
 */
export function checkCollageWindows(
  doc: CollageDocument, pages: readonly CollagePage[], sizeOf: (photoId: string) => CollageSourceSize | null, output: CollageOutput,
): CollageWindowCheck[] {
  const geometry = collagePageGeometry(doc, output);
  const trimPx = { width: geometry.trimWidth, height: geometry.trimHeight };
  const trimMm = geometry.plan ? { width: geometry.plan.trimWidthMm, height: geometry.plan.trimHeightMm } : undefined;
  const checks: CollageWindowCheck[] = [];
  for (const page of pages) {
    const pageNumber = doc.pages.indexOf(page) + 1;
    const add = (window: number, photoId: string, windowPx: { width: number; height: number }, zoom: number) => {
      const size = sizeOf(photoId);
      const sourcePx = size ? { width: size.width, height: size.height } : null;
      checks.push({
        page: pageNumber, window, photoId, filename: size?.filename ?? photoId,
        windowPx: { width: Math.round(windowPx.width), height: Math.round(windowPx.height) }, sourcePx,
        ...measureWindow(sourcePx, windowPx, zoom, output, trimMm, trimPx),
      });
    };
    // The background photograph covers the whole page, bleed included.
    if (page.backgroundPhotoId) add(0, page.backgroundPhotoId, { width: geometry.width, height: geometry.height }, 1);
    page.slots.forEach((slot, index) => {
      if (slot.photoId) add(index + 1, slot.photoId, windowPixels(slot, page.gap, trimPx.width, trimPx.height), slot.zoom ?? 1);
    });
  }
  return checks;
}

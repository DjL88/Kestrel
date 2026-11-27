import { computeHistogram } from './histogram';
import type { Pixels } from './colourCheck';

/**
 * Where the highlights and shadows are clipped, from the preview's own pixels, for drawing on the photo.
 *
 * "Clipped" means exactly what the histogram means by it (src/core/histogram.ts): a pixel with any channel at 255
 * (highlights) or at 0 (shadows). The shares are taken from `computeHistogram`, so the number on the photo and the
 * number beside the histogram are always the same measurement. The regions only say where: the picture is cut into a
 * coarse grid, a cell counts when enough of it is clipped, and touching cells are merged into a few rectangles
 * (fractions of the picture, top-left origin) so drawing stays cheap. Pure; nothing here edits a photo.
 */

export interface ClipRegion { x: number; y: number; width: number; height: number }

export interface ClippingMap {
  /** Share of pixels with any channel at 255 / at 0, 0 to 1. */
  highlightShare: number;
  shadowShare: number;
  /** Where, as merged rectangles. Empty when the clipping is too scattered to outline. */
  highlights: ClipRegion[];
  shadows: ClipRegion[];
}

/** Below this share a clip is not worth a mark on the photo (the histogram's own "pure white" note starts here too). */
export const CLIP_SHOW_FROM = 0.01;
/** The grid is at most this many cells across. */
const GRID = 48;
/** A cell counts as clipped when at least this share of its pixels is. */
const CELL_SHARE = 0.25;
/** More rectangles than this are too ragged to outline honestly. */
const MAX_REGIONS = 64;

const valid = (pixels: Pixels) => Number.isSafeInteger(pixels.width) && Number.isSafeInteger(pixels.height)
  && pixels.width > 0 && pixels.height > 0 && pixels.width * pixels.height * 4 === pixels.data.length;

export interface CellRect { col: number; row: number; cols: number; rows: number }

/** Touching flagged cells as rectangles: runs along each row, then runs with the same span stacked down the rows. */
export function mergeCells(flags: Uint8Array, cols: number, rows: number): CellRect[] {
  const open = new Map<string, CellRect>();
  const done: CellRect[] = [];
  for (let row = 0; row <= rows; row += 1) {
    const seen = new Set<string>();
    if (row < rows) {
      let col = 0;
      while (col < cols) {
        if (!flags[row * cols + col]) { col += 1; continue; }
        const start = col;
        while (col < cols && flags[row * cols + col]) col += 1;
        const key = `${start}:${col - start}`;
        seen.add(key);
        const above = open.get(key);
        if (above && above.row + above.rows === row) above.rows += 1;
        else open.set(key, { col: start, row, cols: col - start, rows: 1 });
      }
    }
    for (const [key, rect] of [...open]) {
      if (!seen.has(key)) { done.push(rect); open.delete(key); }
    }
  }
  return done;
}

function regionsOf(pixels: Pixels, test: (data: Uint8ClampedArray, i: number) => boolean): ClipRegion[] {
  const { width, height, data } = pixels;
  const cell = Math.max(1, Math.ceil(Math.max(width, height) / GRID));
  const cols = Math.ceil(width / cell), rows = Math.ceil(height / cell);
  const hits = new Uint32Array(cols * rows);
  for (let y = 0; y < height; y += 1) {
    const rowBase = Math.floor(y / cell) * cols;
    for (let x = 0; x < width; x += 1) if (test(data, (y * width + x) * 4)) hits[rowBase + Math.floor(x / cell)] += 1;
  }
  const flags = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r += 1) {
    const cellHeight = Math.min(cell, height - r * cell);
    for (let c = 0; c < cols; c += 1) {
      const cellWidth = Math.min(cell, width - c * cell);
      if (hits[r * cols + c] >= CELL_SHARE * cellWidth * cellHeight) flags[r * cols + c] = 1;
    }
  }
  const merged = mergeCells(flags, cols, rows);
  // Too ragged to outline: a bounding box would claim clipping where there is none, so draw nothing and keep the chip.
  if (merged.length > MAX_REGIONS) return [];
  return merged.map((rect) => ({
    x: (rect.col * cell) / width,
    y: (rect.row * cell) / height,
    width: Math.min(rect.cols * cell, width - rect.col * cell) / width,
    height: Math.min(rect.rows * cell, height - rect.row * cell) / height,
  }));
}

/** Null when the pixels are not a valid picture: nothing is guessed. */
export function clippingMap(pixels: Pixels): ClippingMap | null {
  if (!valid(pixels)) return null;
  const histogram = computeHistogram(pixels.data);
  return {
    highlightShare: histogram.highlightClip,
    shadowShare: histogram.shadowClip,
    highlights: histogram.highlightClip >= CLIP_SHOW_FROM ? regionsOf(pixels, (d, i) => d[i] === 255 || d[i + 1] === 255 || d[i + 2] === 255) : [],
    shadows: histogram.shadowClip >= CLIP_SHOW_FROM ? regionsOf(pixels, (d, i) => d[i] === 0 || d[i + 1] === 0 || d[i + 2] === 0) : [],
  };
}

export interface ClipChip {
  kind: 'highlights' | 'shadows';
  /** Whole percent of the picture, at least 1. */
  percent: number;
}

/** The corner chips to show: only a clip worth saying (1% or more), highlights first. Empty when nothing is clipped. */
export function clipChips(map: Pick<ClippingMap, 'highlightShare' | 'shadowShare'> | null | undefined): ClipChip[] {
  if (!map) return [];
  const chips: ClipChip[] = [];
  const add = (kind: ClipChip['kind'], share: number) => {
    if (Number.isFinite(share) && share >= CLIP_SHOW_FROM) chips.push({ kind, percent: Math.max(1, Math.round(share * 100)) });
  };
  add('highlights', map.highlightShare);
  add('shadows', map.shadowShare);
  return chips;
}

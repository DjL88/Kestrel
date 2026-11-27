/**
 * Where denoise looks for noise: a grid of full-size (1:1) crops spread over the whole framed picture, laid side by
 * side in one mosaic, and the map of which mosaic pixels belong to the subject so they can be left out. Pure
 * arithmetic, so it is tested without a canvas; `runDenoise.ts` does the drawing.
 */

export interface NoiseLayout {
  /** Size of each crop, whole numbers of the estimator's 16 px blocks (or the whole picture when it is small). */
  tileWidth: number;
  tileHeight: number;
  cols: number;
  rows: number;
  /** Top-left of each crop in the framed picture at full size, row by row. */
  tiles: { sx: number; sy: number }[];
}

/** Crops per side of the grid. Sixteen spread crops see the shadows and the background round a subject, not only the middle. */
export const NOISE_GRID = 4;
const LARGEST_TILE = 320;
const SMALLEST_TILE = 64;

/** The crops for a framed picture of this size, or null when it is too small to measure. A small picture is read whole. */
export function noiseLayout(width: number, height: number): NoiseLayout | null {
  if (!(width >= SMALLEST_TILE && height >= SMALLEST_TILE)) return null;
  const tile = Math.floor(Math.min(LARGEST_TILE, width / NOISE_GRID, height / NOISE_GRID) / 16) * 16;
  if (tile < SMALLEST_TILE) return { tileWidth: width, tileHeight: height, cols: 1, rows: 1, tiles: [{ sx: 0, sy: 0 }] };
  const tiles: { sx: number; sy: number }[] = [];
  for (let row = 0; row < NOISE_GRID; row += 1) {
    for (let col = 0; col < NOISE_GRID; col += 1) {
      // The middle of each cell of the grid, kept inside the picture.
      const sx = Math.max(0, Math.min(width - tile, Math.round(((col + 0.5) * width) / NOISE_GRID - tile / 2)));
      const sy = Math.max(0, Math.min(height - tile, Math.round(((row + 0.5) * height) / NOISE_GRID - tile / 2)));
      tiles.push({ sx, sy });
    }
  }
  return { tileWidth: tile, tileHeight: tile, cols: NOISE_GRID, rows: NOISE_GRID, tiles };
}

/** A subject's coverage, 0 to 1 per pixel, at the size the subject was found at (the working copy, not full size). */
export interface SubjectCoverage { alpha: Float32Array; width: number; height: number }

/** Coverage above this counts as subject. Low, so the soft edge of a mask is left out too. */
export const SUBJECT_EDGE = 0.05;

/**
 * One byte per mosaic pixel, 1 where the subject is, for `measureBackgroundNoise`. The subject was found on the
 * working copy of the framed picture (`framedWidth` x `framedHeight` at full size), so each full-size pixel is looked up
 * at the same place in the smaller subject map.
 */
export function mosaicExclusion(layout: NoiseLayout, framedWidth: number, framedHeight: number, subject: SubjectCoverage): Uint8Array {
  const { tileWidth, tileHeight, cols, tiles } = layout;
  const mosaicWidth = tileWidth * cols;
  const out = new Uint8Array(mosaicWidth * tileHeight * layout.rows);
  const xs = new Int32Array(tileWidth);
  const ys = new Int32Array(tileHeight);
  tiles.forEach(({ sx, sy }, index) => {
    for (let x = 0; x < tileWidth; x += 1) xs[x] = Math.min(subject.width - 1, Math.floor(((sx + x + 0.5) * subject.width) / framedWidth));
    for (let y = 0; y < tileHeight; y += 1) ys[y] = Math.min(subject.height - 1, Math.floor(((sy + y + 0.5) * subject.height) / framedHeight));
    const left = (index % cols) * tileWidth;
    const top = Math.floor(index / cols) * tileHeight;
    for (let y = 0; y < tileHeight; y += 1) {
      const row = ys[y] * subject.width;
      const at = (top + y) * mosaicWidth + left;
      for (let x = 0; x < tileWidth; x += 1) if (subject.alpha[row + xs[x]] > SUBJECT_EDGE) out[at + x] = 1;
    }
  });
  return out;
}

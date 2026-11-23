/**
 * Pure border / photo fit geometry shared by future V2 canvas and export renderers.
 * No pixels are generated here. A border never hides source pixels: the image is
 * fitted inside the remaining viewport, with unused canvas space left for a fill.
 */
export type BorderPlacement = 'all' | 'horizontal' | 'vertical' | 'auto';
export type PhotoFit = 'contain' | 'cover';
export interface Rect { x: number; y: number; width: number; height: number }
export interface BorderFramePlan {
  output: Rect;
  /** The usable region after explicit border padding; never obscured by that border. */
  inner: Rect;
  /** Where to draw the photograph. In contain mode no image pixels are cropped. */
  photo: Rect;
  /** Leftover areas for solid/gradient/blurred-photo background. */
  bands: Rect[];
  fit: PhotoFit;
  /** The final photo scale. Values above 1 require upscaling, not new detail. */
  scale: number;
  upscales: boolean;
}
const MAX_OUTPUT_SIDE = 20000;
const valid = (value: number) => Number.isSafeInteger(value) && value > 0 && value <= MAX_OUTPUT_SIDE;
const addBand = (out: Rect[], x: number, y: number, width: number, height: number) => {
  if (width > 0 && height > 0) out.push({ x, y, width, height });
};

export function planBorderFrame(
  outputWidth: number,
  outputHeight: number,
  photoWidth: number,
  photoHeight: number,
  options: { placement?: BorderPlacement; borderPercent?: number; fit?: PhotoFit } = {},
): BorderFramePlan {
  if (![outputWidth, outputHeight, photoWidth, photoHeight].every(valid)) {
    throw new RangeError('Photo and output must have positive whole pixel dimensions no greater than 20,000');
  }
  const placement = options.placement ?? 'all';
  if (!['all', 'horizontal', 'vertical', 'auto'].includes(placement)) throw new RangeError('Unknown border placement');
  const fit = options.fit ?? 'contain';
  if (fit !== 'contain' && fit !== 'cover') throw new RangeError('Unknown photo fitting mode');
  const percent = options.borderPercent ?? 0;
  if (!Number.isFinite(percent) || percent < 0 || percent > 10) throw new RangeError('Border width must be between 0 and 10%');

  // Edge padding is a fraction of the output width; auto-mode uses any unused
  // space due to aspect ratio instead of applying a decorative inset.
  const pad = placement === 'auto' ? 0 : Math.round(outputWidth * percent / 100);
  const horizontal = placement === 'all' || placement === 'horizontal';
  const vertical = placement === 'all' || placement === 'vertical';
  const left = vertical ? pad : 0, right = vertical ? pad : 0;
  const top = horizontal ? pad : 0, bottom = horizontal ? pad : 0;
  if (left + right >= outputWidth || top + bottom >= outputHeight) {
    throw new RangeError('Border would leave no space for the photograph');
  }

  const output = { x: 0, y: 0, width: outputWidth, height: outputHeight };
  const inner = { x: left, y: top, width: outputWidth - left - right, height: outputHeight - top - bottom };
  const scale = fit === 'contain'
    ? Math.min(inner.width / photoWidth, inner.height / photoHeight)
    : Math.max(inner.width / photoWidth, inner.height / photoHeight);
  // The photo box is an integer-pixel placement; fit mode always stays inside.
  const width = fit === 'contain' ? Math.min(inner.width, Math.floor(photoWidth * scale)) : inner.width;
  const height = fit === 'contain' ? Math.min(inner.height, Math.floor(photoHeight * scale)) : inner.height;
  const photo = {
    x: inner.x + Math.floor((inner.width - width) / 2),
    y: inner.y + Math.floor((inner.height - height) / 2),
    width,
    height,
  };
  const bands: Rect[] = [];
  // Non-overlapping background bands: explicit border plus contain-fit margins.
  addBand(bands, 0, 0, outputWidth, photo.y);
  addBand(bands, 0, photo.y + photo.height, outputWidth, outputHeight - photo.y - photo.height);
  addBand(bands, 0, photo.y, photo.x, photo.height);
  addBand(bands, photo.x + photo.width, photo.y, outputWidth - photo.x - photo.width, photo.height);
  return { output, inner, photo, bands, fit, scale, upscales: scale > 1 };
}

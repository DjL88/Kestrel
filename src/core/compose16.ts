import type { Rgb16Image } from './master16';
import { downscaleRgb16 } from './rgb16Output';

/**
 * 16-bit framing for format exports: the steps the canvas does for an 8-bit export (border fill, placing the picture
 * with pan, zoom, flips, quarter turns and edge insets, overlays, cutting split sections), done on RGB16 pixels so a
 * format export of a 16-bit picture is rounded to 8 bits at most once, at the very end, or not at all (a 16-bit PNG).
 * Pure: the same code on desktop, web and phones.
 */

export interface Rect16 { x: number; y: number; width: number; height: number }

/** A blank RGB16 picture. */
export function blankRgb16(width: number, height: number): Rgb16Image {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    throw new Error('Invalid 16-bit picture size.');
  return { width, height, data: new Uint16Array(width * height * 3) };
}

/** An 8-bit sRGB colour as 16-bit values (each level times 257, so 255 becomes 65535 exactly). */
export const rgb8To16 = (rgb: readonly [number, number, number]): [number, number, number] =>
  [rgb[0] * 257, rgb[1] * 257, rgb[2] * 257];

/** Fill a rectangle (whole pixels, clamped to the picture) with one colour. */
export function fillRgb16(image: Rgb16Image, colour: readonly [number, number, number], rect: Rect16 = { x: 0, y: 0, width: image.width, height: image.height }) {
  const x0 = Math.max(0, Math.round(rect.x)), y0 = Math.max(0, Math.round(rect.y));
  const x1 = Math.min(image.width, Math.round(rect.x + rect.width)), y1 = Math.min(image.height, Math.round(rect.y + rect.height));
  const { data, width } = image;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const at = (y * width + x) * 3;
      data[at] = colour[0]; data[at + 1] = colour[1]; data[at + 2] = colour[2];
    }
  }
}

/** Copy a whole-pixel rectangle of `source` into `target` at (dx, dy). */
export function copyRgb16(source: Rgb16Image, rect: Rect16, target: Rgb16Image, dx: number, dy: number) {
  const { x, y, width, height } = rect;
  if (![x, y, width, height, dx, dy].every(Number.isSafeInteger) || x < 0 || y < 0 || x + width > source.width || y + height > source.height ||
      dx < 0 || dy < 0 || dx + width > target.width || dy + height > target.height) throw new Error('Invalid 16-bit copy.');
  for (let row = 0; row < height; row += 1) {
    const from = ((y + row) * source.width + x) * 3;
    target.data.set(source.data.subarray(from, from + width * 3), ((dy + row) * target.width + dx) * 3);
  }
}

/** Cut one whole-pixel rectangle out as its own picture. */
export function cropRgb16(source: Rgb16Image, rect: Rect16): Rgb16Image {
  const out = blankRgb16(rect.width, rect.height);
  copyRgb16(source, rect, out, 0, 0);
  return out;
}

/**
 * Where and how the picture is drawn, as the canvas export does it: `translate(centre) rotate(θ) scale(sx, sy)`, then
 * the picture stretched over `drawWidth × drawHeight` centred on the origin, everything clipped to `clip`.
 */
export interface Placement16 {
  centreX: number; centreY: number; rotateRad: number; scaleX: number; scaleY: number;
  drawWidth: number; drawHeight: number;
  clip: Rect16;
}

/**
 * Draw `picture` into `target` with `placement`, in 16 bits. A picture drawn smaller than its own size is first
 * area-averaged to the drawn size (as the 16-bit export already does), so the final sampling is close to one to one;
 * the sampling itself is bilinear. A pixel is drawn when its centre is inside both the clip and the drawn picture.
 */
export function drawRgb16(target: Rgb16Image, picture: Rgb16Image, placement: Placement16) {
  const { centreX, centreY, rotateRad, scaleX, scaleY, drawWidth, drawHeight, clip } = placement;
  if (!(drawWidth > 0 && drawHeight > 0 && scaleX !== 0 && scaleY !== 0) || ![centreX, centreY, rotateRad, scaleX, scaleY].every(Number.isFinite))
    throw new Error('Invalid 16-bit placement.');
  // Drawn size in output pixels; shrink the picture to it first when that is smaller (never enlarge here).
  const shownWidth = Math.abs(drawWidth * scaleX), shownHeight = Math.abs(drawHeight * scaleY);
  let source = picture;
  if (shownWidth < picture.width - 0.5 || shownHeight < picture.height - 0.5) {
    const w = Math.max(1, Math.min(picture.width, Math.round(shownWidth)));
    const h = Math.max(1, Math.min(picture.height, Math.round(shownHeight)));
    if (w < picture.width || h < picture.height) source = downscaleRgb16(picture, w, h);
  }
  const sw = source.width, sh = source.height, src = source.data;
  const cos = Math.cos(rotateRad), sin = Math.sin(rotateRad);
  // Whole quarter turns are exact; round away floating-point dust so pixels land on the same grid as the canvas.
  const c = Math.abs(cos) < 1e-12 ? 0 : cos, s = Math.abs(sin) < 1e-12 ? 0 : sin;
  const kx = sw / drawWidth, ky = sh / drawHeight;
  const x0 = Math.max(0, Math.ceil(clip.x - 0.5)), y0 = Math.max(0, Math.ceil(clip.y - 0.5));
  const x1 = Math.min(target.width, Math.ceil(clip.x + clip.width - 0.5)), y1 = Math.min(target.height, Math.ceil(clip.y + clip.height - 0.5));
  const out = target.data, tw = target.width;
  const halfW = drawWidth / 2, halfH = drawHeight / 2;
  for (let y = y0; y < y1; y += 1) {
    const dy = y + 0.5 - centreY;
    for (let x = x0; x < x1; x += 1) {
      const dx = x + 0.5 - centreX;
      // Undo the rotation, then the scale (flips are negative scales), to reach drawn-picture coordinates.
      const ux = (c * dx + s * dy) / scaleX;
      const uy = (-s * dx + c * dy) / scaleY;
      if (ux < -halfW || ux >= halfW || uy < -halfH || uy >= halfH) continue;
      const px = Math.min(sw - 1, Math.max(0, (ux + halfW) * kx - 0.5));
      const py = Math.min(sh - 1, Math.max(0, (uy + halfH) * ky - 0.5));
      const ix = Math.floor(px), iy = Math.floor(py);
      const fx = px - ix, fy = py - iy;
      const ix1 = Math.min(sw - 1, ix + 1), iy1 = Math.min(sh - 1, iy + 1);
      const a = (iy * sw + ix) * 3, b = (iy * sw + ix1) * 3, d = (iy1 * sw + ix) * 3, e = (iy1 * sw + ix1) * 3;
      const to = (y * tw + x) * 3;
      for (let ch = 0; ch < 3; ch += 1) {
        const top = src[a + ch] + (src[b + ch] - src[a + ch]) * fx;
        const bottom = src[d + ch] + (src[e + ch] - src[d + ch]) * fx;
        out[to + ch] = Math.round(top + (bottom - top) * fy);
      }
    }
  }
}

/**
 * Lay an 8-bit RGBA sheet (text and watermark drawn on a transparent canvas, unpremultiplied as `getImageData` gives
 * it) over the 16-bit picture with normal "source-over" blending. Where the sheet is clear the picture keeps its
 * 16-bit values untouched; only the pixels the overlay covers take its colour.
 */
export function overlayRgba8OnRgb16(target: Rgb16Image, rgba: ArrayLike<number>) {
  const { width, height, data } = target;
  if (rgba.length !== width * height * 4) throw new Error('The overlay sheet does not match the picture size.');
  for (let i = 0, j = 0; i < width * height; i += 1, j += 3) {
    const alpha = rgba[i * 4 + 3];
    if (alpha === 0) continue;
    const a = alpha / 255;
    for (let ch = 0; ch < 3; ch += 1) {
      const under = data[j + ch];
      data[j + ch] = Math.round(under + (rgba[i * 4 + ch] * 257 - under) * a);
    }
  }
}

/**
 * True when every value is a whole 8-bit level times 257: what a picture that went through 8 bits looks like. A
 * real 16-bit gradient returns false. Use it to prove an export was not rounded to 8 bits on the way.
 */
export function looksEightBit(image: Rgb16Image): boolean {
  for (let i = 0; i < image.data.length; i += 1) if (image.data[i] % 257 !== 0) return false;
  return true;
}

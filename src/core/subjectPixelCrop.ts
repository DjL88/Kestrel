import type { NormalisedBox } from './subjectDetailBurst';

/** Unedited, orientation-corrected source raster supplied by the current-photo decoder.
 * Never silently use a reduced preview as proof of full-resolution eye detail.
 */
export interface SourcePixelRaster {
  photoId: string;
  sourceSha256: string;
  width: number;
  height: number;
  rgba: Uint8Array;
  /** Actual decoded raster dimensions must equal the declared source pixel dimensions. */
  sourceWidth: number;
  sourceHeight: number;
}
export interface PixelCrop {
  photoId: string;
  sourceSha256: string;
  x: number; y: number; width: number; height: number;
  rgba: Uint8Array;
}
const digest = /^[0-9a-f]{64}$/i;
const unit = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;

/** Exact source pixels for Select A/B at 100%; no interpolation, fake eye location,
 * inferred identity, ranking, source writes or automatic cull decisions.
 * Returns null when the original or geometry cannot be proved.
 */
export function exactSubjectPixelCrop(
  raster: SourcePixelRaster, expectedPhotoId: string, expectedSourceSha256: string,
  box: NormalisedBox, maxBytes = 32 * 1024 * 1024,
): PixelCrop | null {
  const { width, height } = raster;
  if (!expectedPhotoId || raster.photoId !== expectedPhotoId ||
      !digest.test(expectedSourceSha256) || raster.sourceSha256 !== expectedSourceSha256 ||
      !Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width < 1 || height < 1 || width !== raster.sourceWidth || height !== raster.sourceHeight ||
      !Number.isSafeInteger(width * height * 4) || raster.rgba.byteLength !== width * height * 4 ||
      !unit(box.x) || !unit(box.y) || !unit(box.width) || !unit(box.height) ||
      box.width <= 0 || box.height <= 0 ||
      box.x + box.width > 1 + 1e-9 || box.y + box.height > 1 + 1e-9 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 4) return null;
  const x = Math.floor(box.x * width), y = Math.floor(box.y * height);
  const right = Math.min(width, Math.ceil((box.x + box.width) * width));
  const bottom = Math.min(height, Math.ceil((box.y + box.height) * height));
  const w = right - x, h = bottom - y;
  if (w < 1 || h < 1 || w * h * 4 > maxBytes) return null;
  const rgba = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row++) {
    const start = ((y + row) * width + x) * 4;
    rgba.set(raster.rgba.subarray(start, start + w * 4), row * w * 4);
  }
  return { photoId: expectedPhotoId, sourceSha256: expectedSourceSha256, x, y, width: w, height: h, rgba };
}

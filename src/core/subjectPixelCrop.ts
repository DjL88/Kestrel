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

/** A/B proof is deliberately NOT a cull score: different lenses, exposure,
 * subject motion and eye placement can make edge energy misleading.
 */
export interface SubjectProofRequest {
  raster: SourcePixelRaster;
  photoId: string;
  sourceSha256: string;
  box: NormalisedBox;
  /** Source folder + burst identity established upstream, never guessed from time alone. */
  comparisonGroup: string;
}
export interface SubjectProofPair {
  left: PixelCrop;
  right: PixelCrop;
  /** Measured average neighbouring luminance difference in unscaled source pixels. */
  leftEdgeEnergy: number;
  rightEdgeEnergy: number;
  /** Always review: edge energy is not proof of a focused eye or a better keeper. */
  recommendation: 'review';
}

/** Relative image texture evidence only. No species, eye location, pose or
 * calibrated blur score is inferred. Alpha-transparent pixels are excluded.
 */
function sourceEdgeEnergy(crop: PixelCrop): number {
  const { width: w, height: h, rgba } = crop;
  let sum = 0;
  let count = 0;
  const luma = (i: number) => rgba[i] * 0.2126 + rgba[i + 1] * 0.7152 + rgba[i + 2] * 0.0722;
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      const right = i + 4;
      const below = i + w * 4;
      if (rgba[i + 3] < 255 || rgba[right + 3] < 255 || rgba[below + 3] < 255) continue;
      const centre = luma(i);
      sum += Math.abs(centre - luma(right)) + Math.abs(centre - luma(below));
      count += 2;
    }
  }
  return count ? sum / count : 0;
}

/** Build two exact-pixel crops without exceeding a shared memory budget.
 * Both images must belong to the same independently established source group.
 * Neither source hash is computed here: the decoder must verify each original.
 */
export function exactSubjectProofPair(
  left: SubjectProofRequest,
  right: SubjectProofRequest,
  maxBytes = 32 * 1024 * 1024,
): SubjectProofPair | null {
  if (!left.comparisonGroup.trim() || left.comparisonGroup !== right.comparisonGroup ||
      left.photoId === right.photoId || !Number.isSafeInteger(maxBytes) || maxBytes < 8)
    return null;
  // Split the budget before allocating either crop; no unbounded pair of
  // full-frame copies on phones or other low-memory devices.
  const half = Math.floor(maxBytes / 2);
  const a = exactSubjectPixelCrop(left.raster, left.photoId, left.sourceSha256, left.box, half);
  if (!a) return null;
  const b = exactSubjectPixelCrop(right.raster, right.photoId, right.sourceSha256, right.box, maxBytes - a.rgba.byteLength);
  if (!b) return null;
  // Without equivalent source-pixel crop geometry, raw edge energy is not
  // directly comparable; do not present an unfair sharpness comparison.
  if (a.width !== b.width || a.height !== b.height || a.width < 2 || a.height < 2) return null;
  return { left: a, right: b, leftEdgeEnergy: sourceEdgeEnergy(a),
    rightEdgeEnergy: sourceEdgeEnergy(b), recommendation: 'review' };
}

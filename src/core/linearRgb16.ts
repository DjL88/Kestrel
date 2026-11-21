/** NOT USED by the 16-bit export: master16 composites in encoded space like the 8-bit preview (see previewMasterParity.test.ts).
 * Adopt only together with a matching change to applyMasks. Note applyPhotoEditLinear returns display-encoded values. */
/** RGB16 is sRGB display-encoded, not scene-linear sensor CFA.
 * Local adjustments are mixed in linear light and encoded back to sRGB16.
 * This preserves neutral pixels exactly and avoids dark mask-edge fringes.
 * No camera profile or RAW provenance is inferred here.
 */
const LINEAR = Float32Array.from({ length: 65536 }, (_, i) => {
  const c = i / 65535;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
export function decodeSrgb16(sample: number): number {
  if (!Number.isInteger(sample) || sample < 0 || sample > 65535) {
    throw new RangeError('Invalid 16-bit sRGB channel.');
  }
  return LINEAR[sample];
}
export function encodeSrgb16(linear: number): number {
  const c = Math.min(1, Math.max(0, Number.isFinite(linear) ? linear : 0));
  return Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 65535);
}
/** Exact identity for alpha=0/1, and linear-light mixing at intermediate coverage. */
export function blendSrgb16(source: number, adjusted: number, alpha: number): number {
  if (!Number.isFinite(alpha)) throw new RangeError('Invalid mask coverage.');
  if (alpha <= 0) return source;
  if (alpha >= 1) return adjusted;
  return encodeSrgb16(decodeSrgb16(source) * (1 - alpha) + decodeSrgb16(adjusted) * alpha);
}
/** When the adjusted value is already linear (from applyPhotoEditLinear). */
export function blendLinearToSrgb16(source: number, adjustedLinear: number, alpha: number): number {
  if (!Number.isFinite(alpha) || !Number.isFinite(adjustedLinear)) throw new RangeError('Invalid linear colour or mask coverage.');
  if (alpha <= 0) return source;
  if (alpha >= 1) return encodeSrgb16(adjustedLinear);
  return encodeSrgb16(decodeSrgb16(source) * (1 - alpha) + adjustedLinear * alpha);
}

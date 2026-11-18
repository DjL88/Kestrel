/**
 * TrueDetail prototype: confidence-weighted, non-destructive per-pixel blending.
 * Operates on supplied linear-light Float32 RGBA buffers. No RAW decode, I/O,
 * segmentation model, or original-file mutation occurs here.
 *
 * confidence and coverage are independent arrays of values in [0, 1].
 * A confidence map is NOT a calibrated probability without model validation.
 * Edge-aware mask refinement and halo control are separate future stages.
 */
export function blendConfidenceMask(base, enhanced, confidence, coverage, strength = 1) {
  if (!(base instanceof Float32Array) || !(enhanced instanceof Float32Array))
    throw new TypeError('Pixels must be Float32Array');
  if (!(confidence instanceof Float32Array) || !(coverage instanceof Float32Array))
    throw new TypeError('Masks must be Float32Array');
  if (base.length !== enhanced.length || base.length % 4 !== 0 ||
      confidence.length !== base.length / 4 || coverage.length !== confidence.length)
    throw new RangeError('RGBA and mask dimensions differ');
  if (!Number.isFinite(strength) || strength < 0 || strength > 1)
    throw new RangeError('Strength must be finite in [0,1]');
  const output = new Float32Array(base.length);
  for (let p = 0; p < confidence.length; p++) {
    const c = confidence[p], m = coverage[p];
    if (!Number.isFinite(c) || c < 0 || c > 1 ||
        !Number.isFinite(m) || m < 0 || m > 1)
      throw new RangeError('Confidence and coverage must be finite in [0,1]');
    const a = c * m * strength, offset = p * 4;
    for (let k = 0; k < 3; k++) {
      const x = base[offset + k], y = enhanced[offset + k];
      if (!Number.isFinite(x) || !Number.isFinite(y))
        throw new RangeError('Non-finite pixel channel');
      output[offset + k] = x + (y - x) * a;
    }
    // Preserve the original alpha; masks do not alter transparency.
    if (!Number.isFinite(base[offset + 3]) || !Number.isFinite(enhanced[offset + 3]))
      throw new RangeError('Non-finite alpha');
    output[offset + 3] = base[offset + 3];
  }
  return output;
}

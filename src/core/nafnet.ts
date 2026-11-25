/**
 * NAFNet-SIDD-width32 (Chen et al., Megvii, MIT): a learned denoiser for developed (display-encoded) RGB, trained on
 * real smartphone noise (SIDD). Its tensor contract is the same as TrueDetail's: [1,3,256,256] RGB 0..1 in, the
 * restored tile out (not a residual), so it runs through `runTrueDetailTiles` with the same halo, strength and
 * subject protection. The model does not clamp its output; values are clamped to 0..1 here, never silently
 * rescaled. A tile with a non-finite value is refused, so a bad tile can never reach the photo.
 */
export const NAFNET_TILE = 256;

export function nafnetOutput(raw: Float32Array, expected = 3 * NAFNET_TILE * NAFNET_TILE): Float32Array {
  if (raw.length !== expected) throw new Error('Unexpected denoise output shape');
  const out = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    const v = raw[i];
    if (!Number.isFinite(v)) throw new Error('Invalid denoise output samples');
    out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return out;
}

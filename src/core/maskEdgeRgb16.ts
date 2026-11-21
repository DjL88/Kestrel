import { decodeSrgb16 } from './linearRgb16';

/**
 * Gentle mask-edge protection in *linear light* for display-encoded RGB16.
 *
 * The original and locally adjusted RGB are evaluated in the same linear-light
 * domain, so the result does not depend on 8-bit proof quantisation. Strong
 * local changes are tapered only in the transition ring (0 < alpha < 1).
 * No image pixels, textures or subject parts are synthesised. Exact endpoints
 * and ordinary small adjustments are untouched.
 *
 * This is a bounded photographic guardrail, NOT an anatomy detector or proof
 * that an edge is halo-free. Output colour is still sRGB until the real camera
 * profile pipeline is verified.
 */
export function protectedMaskAlpha(
  alpha: number,
  original: readonly [number, number, number],
  adjusted: readonly [number, number, number],
): number {
  if (!Number.isFinite(alpha)) return 0;
  if (alpha <= 0) return 0;
  if (alpha >= 1) return 1;
  const luminance = (rgb: readonly [number, number, number]) =>
    0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  const a = luminance(original);
  const b = luminance(adjusted);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  // Stops of luminance change; epsilon only stabilises nearly-black samples.
  const stops = Math.abs(Math.log2((b + 0.002) / (a + 0.002)));
  if (stops <= 0.55) return alpha;
  // Smooth boundary-ring envelope: zero at fully outside/inside, one at 50%.
  const ring = 4 * alpha * (1 - alpha);
  // Cap attenuation at 35%; protect only against unusually strong local edits.
  const severity = Math.min(1, Math.max(0, (stops - 0.55) / 1.5));
  return alpha * (1 - 0.35 * ring * severity);
}

/** Convenience adapter for the actual RGB16 export buffer. */
export function protectedMaskAlphaSrgb16(
  alpha: number,
  source: Uint16Array,
  sourceOffset: number,
  adjusted: Uint16Array,
  adjustedOffset: number,
): number {
  if (alpha <= 0 || alpha >= 1) return alpha <= 0 ? 0 : 1;
  return protectedMaskAlpha(
    alpha,
    [decodeSrgb16(source[sourceOffset]), decodeSrgb16(source[sourceOffset + 1]), decodeSrgb16(source[sourceOffset + 2])],
    [decodeSrgb16(adjusted[adjustedOffset]), decodeSrgb16(adjusted[adjustedOffset + 1]), decodeSrgb16(adjusted[adjustedOffset + 2])],
  );
}

/** Tone renderer already holds the adjusted values as scene-linear floats. */
export function protectedMaskAlphaLinear(
  alpha: number,
  source: Uint16Array,
  sourceOffset: number,
  adjusted: Float32Array,
  adjustedOffset: number,
): number {
  if (alpha <= 0 || alpha >= 1) return alpha <= 0 ? 0 : 1;
  return protectedMaskAlpha(
    alpha,
    [decodeSrgb16(source[sourceOffset]), decodeSrgb16(source[sourceOffset + 1]), decodeSrgb16(source[sourceOffset + 2])],
    [adjusted[adjustedOffset], adjusted[adjustedOffset + 1], adjusted[adjustedOffset + 2]],
  );
}

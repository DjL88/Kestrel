import { protectedMaskAlpha } from './maskEdgeRgb16';

/**
 * Preview-only compositor: the screen receives 8-bit sRGB, whereas the
 * archival RAW master retains RGB16. Decode the encoded values to linear
 * light, attenuate only unusually harsh partially selected edges using the
 * SAME photographic guard as RGB16, then encode for the display.
 *
 * This must never become a working master or a source for archival output.
 */
const linear8 = Float32Array.from({ length: 256 }, (_, sample) => {
  const value = sample / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
});

const encode8 = (value: number): number => {
  const bounded = Math.max(0, Math.min(1, value));
  return Math.round((bounded <= 0.0031308 ? 12.92 * bounded : 1.055 * bounded ** (1 / 2.4) - 0.055) * 255);
};

/**
 * Mix RGB only; preserve the image's original alpha channel and exact fully
 * masked / unmasked endpoints. Inputs are owned sRGB preview bytes, not RAW.
 */
export function blendMaskPixelSrgb8(
  output: Uint8ClampedArray,
  adjusted: Uint8ClampedArray,
  at: number,
  alpha: number,
): void {
  if (!Number.isFinite(alpha) || alpha <= 0) return;
  if (alpha >= 1) {
    output[at] = adjusted[at];
    output[at + 1] = adjusted[at + 1];
    output[at + 2] = adjusted[at + 2];
    return;
  }
  const source: [number, number, number] = [
    linear8[output[at]], linear8[output[at + 1]], linear8[output[at + 2]],
  ];
  const target: [number, number, number] = [
    linear8[adjusted[at]], linear8[adjusted[at + 1]], linear8[adjusted[at + 2]],
  ];
  const safeAlpha = protectedMaskAlpha(alpha, source, target);
  if (safeAlpha <= 0) return;
  for (let channel = 0; channel < 3; channel++) {
    output[at + channel] = encode8(source[channel] * (1 - safeAlpha) + target[channel] * safeAlpha);
  }
}

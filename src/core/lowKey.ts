/**
 * Is this picture dark on purpose? Most of the frame is very dark and a clearly lit area stands out: a bird against a dark
 * wood, a moon, a stage. Darkness is the mood there, so brightening, adding contrast or calling the shadows "crushed" works
 * against the photo. A merely underexposed picture has no lit area and is not low-key.
 *
 * Same rule as Suggest a look (autoEnhance.ts), worked out on the picture's own brightness so it can be used on any
 * RGBA pixels. Measured on a kingfisher: 70% of pixels below 0.05, the lit bird about 0.31.
 */
export function isLowKeyPixels(rgba: Uint8ClampedArray): boolean {
  const count = rgba.length / 4;
  if (count < 64) return false;
  const stride = Math.max(1, Math.floor(count / 40_000)); // plenty of samples, never slow
  const tones: number[] = [];
  for (let i = 0; i < count; i += stride) {
    const j = i * 4;
    tones.push((0.2126 * rgba[j] + 0.7152 * rgba[j + 1] + 0.0722 * rgba[j + 2]) / 255);
  }
  tones.sort((a, b) => a - b);
  const at = (q: number) => tones[Math.min(tones.length - 1, Math.floor(q * tones.length))];
  return at(0.7) < 0.12 && at(0.99) > 0.25 && at(0.99) - at(0.5) > 0.2;
}

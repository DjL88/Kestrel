/** What the device can draw at once. iPhone and iPad refuse a picture much larger than about 16.7 megapixels. */
export function maxCanvasPixels(env: { userAgent: string; platform?: string; maxTouchPoints?: number }): number {
  const ios = /iPhone|iPad|iPod/.test(env.userAgent) || (env.platform === 'MacIntel' && (env.maxTouchPoints ?? 0) > 1);
  if (ios) return 16_777_216;
  if (/Android/.test(env.userAgent)) return 50_000_000;
  return 120_000_000;
}

/** How much to scale a picture of this size so it stays within the limit. 1 means it already fits. */
export function fitScale(width: number, height: number, limit: number): number {
  // Invalid or overflowing dimensions must not silently bypass the canvas cap.
  const pixels = width * height;
  if (![width, height, limit, pixels].every(Number.isFinite) ||
      width <= 0 || height <= 0 || limit <= 0 ||
      !Number.isSafeInteger(pixels)) {
    throw new RangeError('Invalid image dimensions or canvas pixel limit.');
  }
  return pixels > limit ? Math.sqrt(limit / pixels) * 0.999 : 1;
}

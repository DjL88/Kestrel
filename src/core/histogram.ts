export interface Histogram {
  luma: Uint32Array;
  red: Uint32Array;
  green: Uint32Array;
  blue: Uint32Array;
  pixels: number;
  /** Fraction of pixels where any channel is 0 (shadow clipping) or 255 (highlight clipping). */
  shadowClip: number;
  highlightClip: number;
}

export function computeHistogram(data: Uint8ClampedArray): Histogram {
  const luma = new Uint32Array(256);
  const red = new Uint32Array(256);
  const green = new Uint32Array(256);
  const blue = new Uint32Array(256);
  let shadow = 0;
  let highlight = 0;
  const pixels = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    red[r] += 1;
    green[g] += 1;
    blue[b] += 1;
    luma[Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)] += 1;
    if (r === 0 || g === 0 || b === 0) shadow += 1;
    if (r === 255 || g === 255 || b === 255) highlight += 1;
  }
  return { luma, red, green, blue, pixels, shadowClip: pixels ? shadow / pixels : 0, highlightClip: pixels ? highlight / pixels : 0 };
}

/** Smooth, normalised bins for drawing. A square-root scale stops one tall spike hiding the rest. */
export function histogramBars(bins: Uint32Array, count = 64): number[] {
  const size = bins.length / count;
  const sums = Array.from({ length: count }, (_, bar) => {
    let total = 0;
    for (let i = Math.floor(bar * size); i < Math.floor((bar + 1) * size); i += 1) total += bins[i];
    return Math.sqrt(total);
  });
  const peak = Math.max(...sums, 1);
  return sums.map((value) => value / peak);
}

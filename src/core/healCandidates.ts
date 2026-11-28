/**
 * Spot candidates: small, compact, isolated specks that differ clearly from their surroundings (sensor dust, a bright
 * droplet, a stray fleck). Only suggestions: nothing is changed until the person accepts one, and detection never claims
 * to know what a speck is. Pure, on a bounded picture; coordinates are framed-photo shares (0 to 1), like HealSpot.
 */
export interface SpotCandidate {
  x: number;
  y: number;
  /** Radius as a share of the long edge, with a margin so the cover reaches past the speck's edge. */
  r: number;
  /** How far the speck's tone is from its surroundings, 0 to 255. */
  contrast: number;
  tone: 'darker' | 'lighter';
}

export const MAX_SPOT_CANDIDATES = 40;

export function findSpotCandidates(
  pixels: ArrayLike<number>, width: number, height: number, channels: number, limit = MAX_SPOT_CANDIDATES,
): SpotCandidate[] {
  if (width < 24 || height < 24) return [];
  const edge = Math.max(width, height);
  const luma = new Float32Array(width * height);
  for (let i = 0; i < luma.length; i += 1) {
    const p = i * channels;
    luma[i] = 0.2126 * pixels[p] + 0.7152 * pixels[p + 1] + 0.0722 * pixels[p + 2];
  }
  // Integral image for box means.
  const stride = width + 1;
  const integral = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let row = 0;
    for (let x = 0; x < width; x += 1) {
      row += luma[y * width + x];
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row;
    }
  }
  const sum = (x0: number, y0: number, x1: number, y1: number) =>
    integral[y1 * stride + x1] - integral[y0 * stride + x1] - integral[y1 * stride + x0] + integral[y0 * stride + x0];
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
  const inner = Math.max(2, Math.round(edge * 0.002));
  const outer = Math.max(inner * 4, Math.round(edge * 0.012));
  const THRESHOLD = 28;
  const sign = new Int8Array(width * height);
  const delta = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ix0 = clamp(x - inner, width), ix1 = clamp(x + inner + 1, width), iy0 = clamp(y - inner, height), iy1 = clamp(y + inner + 1, height);
      const ox0 = clamp(x - outer, width), ox1 = clamp(x + outer + 1, width), oy0 = clamp(y - outer, height), oy1 = clamp(y + outer + 1, height);
      const innerArea = (ix1 - ix0) * (iy1 - iy0), outerArea = (ox1 - ox0) * (oy1 - oy0);
      const ringArea = outerArea - innerArea;
      if (ringArea <= 0) continue;
      const innerMean = sum(ix0, iy0, ix1, iy1) / innerArea;
      const ringMean = (sum(ox0, oy0, ox1, oy1) - sum(ix0, iy0, ix1, iy1)) / ringArea;
      const d = innerMean - ringMean;
      if (Math.abs(d) >= THRESHOLD) { sign[y * width + x] = d < 0 ? -1 : 1; delta[y * width + x] = d; }
    }
  }
  const maxSide = Math.max(4, Math.round(edge * 0.03));
  const seen = new Uint8Array(width * height);
  const found: SpotCandidate[] = [];
  const queue: number[] = [];
  for (let start = 0; start < sign.length; start += 1) {
    if (!sign[start] || seen[start]) continue;
    const s = sign[start];
    let minX = width, maxX = 0, minY = height, maxY = 0, area = 0, peak = 0, tooBig = false;
    queue.length = 0; queue.push(start); seen[start] = 1;
    while (queue.length) {
      const i = queue.pop()!;
      const x = i % width, y = (i - x) / width;
      area += 1;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      peak = Math.max(peak, Math.abs(delta[i]));
      if (maxX - minX > maxSide || maxY - minY > maxSide) tooBig = true;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = ny * width + nx;
        if (sign[n] === s && !seen[n]) { seen[n] = 1; queue.push(n); }
      }
    }
    if (tooBig) continue;
    const w = maxX - minX + 1, h = maxY - minY + 1;
    // Compact: a roundish blob that fills much of its box, not a line or an edge.
    if (area < 4 || Math.max(w, h) / Math.min(w, h) > 2.2 || area / (w * h) < 0.4) continue;
    // Not touching the picture's border, where a "speck" is usually just the frame's edge.
    if (minX <= 1 || minY <= 1 || maxX >= width - 2 || maxY >= height - 2) continue;
    const r = Math.min(0.15, Math.max(0.002, (Math.max(w, h) / 2 + inner + 2) / edge));
    found.push({
      x: Number((((minX + maxX + 1) / 2) / width).toFixed(5)), y: Number((((minY + maxY + 1) / 2) / height).toFixed(5)),
      r: Number(r.toFixed(5)), contrast: Math.round(peak), tone: s < 0 ? 'darker' : 'lighter',
    });
  }
  found.sort((a, b) => b.contrast - a.contrast);
  const kept: SpotCandidate[] = [];
  for (const c of found) {
    if (kept.some((o) => Math.hypot((o.x - c.x) * width, (o.y - c.y) * height) < (o.r + c.r) * edge)) continue;
    kept.push(c);
    if (kept.length >= limit) break;
  }
  return kept;
}

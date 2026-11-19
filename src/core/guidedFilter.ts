/**
 * Edge-aware refinement of a soft mask against the photo (the guided filter of He, Sun and Tang, 2010).
 *
 * Inside each small window the refined mask is a straight-line function of the photo's brightness, fitted to the
 * coarse mask. Where the photo has an edge (a feather against the sky) the mask takes that edge; where the photo is
 * flat the mask is simply smoothed. It moves the mask's edge, never the picture, and invents nothing.
 */

/** Box mean with a window of (2r + 1)², clipped at the borders, via a summed-area table. */
function boxMean(values: Float32Array, width: number, height: number, r: number): Float32Array {
  const stride = width + 1;
  const table = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let row = 0;
    for (let x = 0; x < width; x += 1) {
      row += values[y * width + x];
      table[(y + 1) * stride + x + 1] = table[y * stride + x + 1] + row;
    }
  }
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - r), y1 = Math.min(height, y + r + 1);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - r), x1 = Math.min(width, x + r + 1);
      const sum = table[y1 * stride + x1] - table[y0 * stride + x1] - table[y1 * stride + x0] + table[y0 * stride + x0];
      out[y * width + x] = sum / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

/**
 * Refine `mask` (0 to 1) against `guide` (brightness 0 to 1), both width × height. `radius` is the window half-size in
 * pixels; `epsilon` is how strong an edge must be before the mask follows it (smaller follows finer edges). Returns a
 * new mask clamped to 0 to 1, or null when the inputs don't match.
 */
export function guidedFilter(guide: Float32Array, mask: Float32Array, width: number, height: number, radius: number, epsilon: number): Float32Array | null {
  const count = width * height;
  if (!(width > 0 && height > 0) || guide.length !== count || mask.length !== count) return null;
  if (!(radius >= 1) || !(epsilon > 0)) return null;
  const r = Math.round(radius);
  const product = new Float32Array(count);
  const squares = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const g = guide[i], m = mask[i];
    if (!Number.isFinite(g) || !Number.isFinite(m)) return null;
    product[i] = g * m;
    squares[i] = g * g;
  }
  const meanGuide = boxMean(guide, width, height, r);
  const meanMask = boxMean(mask, width, height, r);
  const meanProduct = boxMean(product, width, height, r);
  const meanSquares = boxMean(squares, width, height, r);
  const a = new Float32Array(count);
  const b = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const variance = meanSquares[i] - meanGuide[i] * meanGuide[i];
    const covariance = meanProduct[i] - meanGuide[i] * meanMask[i];
    a[i] = covariance / (variance + epsilon);
    b[i] = meanMask[i] - a[i] * meanGuide[i];
  }
  const meanA = boxMean(a, width, height, r);
  const meanB = boxMean(b, width, height, r);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i += 1) out[i] = Math.min(1, Math.max(0, meanA[i] * guide[i] + meanB[i]));
  return out;
}

/** Bilinear resample of a square model map (size × size) to width × height. */
export function resampleMap(map: Float32Array, size: number, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const fy = Math.min(size - 1.001, Math.max(0, ((y + 0.5) / height) * size - 0.5));
    const y0 = Math.floor(fy), ty = fy - y0;
    for (let x = 0; x < width; x += 1) {
      const fx = Math.min(size - 1.001, Math.max(0, ((x + 0.5) / width) * size - 0.5));
      const x0 = Math.floor(fx), tx = fx - x0;
      out[y * width + x] = (map[y0 * size + x0] * (1 - tx) + map[y0 * size + x0 + 1] * tx) * (1 - ty) +
        (map[(y0 + 1) * size + x0] * (1 - tx) + map[(y0 + 1) * size + x0 + 1] * tx) * ty;
    }
  }
  return out;
}

/**
 * Dehaze (standard editor, 25 Nov 2026): a dark-channel haze model. Haze adds a veil of the sky's colour that grows
 * with distance; we estimate that colour (the airlight) from the haziest pixels, estimate how much veil each area
 * has from a softened dark channel, and take it away (positive amount) or add more (negative). It runs first, on the
 * picture's own pixels, before tone, like noise reduction. It makes no claim to recover detail that is not there.
 *
 * The airlight is measured on a fixed-size, block-averaged copy (AIRLIGHT_EDGE across the long edge), so a 2,200-pixel
 * preview, a thumbnail and a full-size export of the same framed photo find the same haze colour and agree.
 */
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export const validDehaze = (value: unknown): value is number => finite(value) && value >= -1 && value <= 1;

/** Softening of the dark channel, as a share of the photo's long edge. */
const DARK_RADIUS = 0.008;
/** The lowest transmission allowed, so dense haze is thinned rather than torn into noise. */
const MIN_TRANSMISSION = 0.25;
/** Haze removed at full strength (1 would remove all of it, which looks false). */
const STRENGTH = 0.9;
const ADD_STRENGTH = 0.6;
/** The airlight is never taken as darker than this, so a photo with no bright haze is not pushed hard. */
const MIN_AIRLIGHT = 0.6;

function boxBlur(source: Float32Array, width: number, height: number, radius: number): Float32Array {
  const r = Math.max(1, Math.round(radius / Math.sqrt(3)));
  const a = source.slice();
  const b = new Float32Array(source.length);
  for (let k = 0; k < 3; k += 1) {
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      let sum = 0;
      for (let i = -r; i <= r; i += 1) sum += a[row + Math.min(width - 1, Math.max(0, i))];
      for (let x = 0; x < width; x += 1) {
        b[row + x] = sum / (2 * r + 1);
        sum += a[row + Math.min(width - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let i = -r; i <= r; i += 1) sum += b[Math.min(height - 1, Math.max(0, i)) * width + x];
      for (let y = 0; y < height; y += 1) {
        a[y * width + x] = sum / (2 * r + 1);
        sum += b[Math.min(height - 1, y + r + 1) * width + x] - b[Math.max(0, y - r) * width + x];
      }
    }
  }
  return a;
}

/** Long edge of the block-averaged copy the airlight is measured on. */
export const AIRLIGHT_EDGE = 256;

/**
 * The haze colour (0..1 per channel): the mean of the 0.2% of blocks with the brightest dark channel, measured on the
 * picture averaged into blocks so there are AIRLIGHT_EDGE across its long edge. Independent of the resolution it is
 * given, which keeps preview and export in step.
 */
export function airlight(pixels: Uint8ClampedArray | Uint16Array, width: number, height: number, stride: 3 | 4, max: number): [number, number, number] {
  const scale = Math.max(width, height) / AIRLIGHT_EDGE;
  const bw = Math.max(1, Math.round(width / Math.max(1, scale)));
  const bh = Math.max(1, Math.round(height / Math.max(1, scale)));
  const sums = new Float64Array(bw * bh * 3);
  const counts = new Uint32Array(bw * bh);
  for (let y = 0; y < height; y += 1) {
    const by = Math.min(bh - 1, Math.floor((y * bh) / height));
    for (let x = 0; x < width; x += 1) {
      const b = by * bw + Math.min(bw - 1, Math.floor((x * bw) / width));
      const i = (y * width + x) * stride;
      sums[b * 3] += pixels[i]; sums[b * 3 + 1] += pixels[i + 1]; sums[b * 3 + 2] += pixels[i + 2];
      counts[b] += 1;
    }
  }
  const blocks = bw * bh;
  const dark = new Float32Array(blocks);
  for (let b = 0; b < blocks; b += 1) {
    const n = Math.max(1, counts[b]) * max;
    dark[b] = Math.min(sums[b * 3], sums[b * 3 + 1], sums[b * 3 + 2]) / n;
  }
  const order = Array.from(dark.keys()).sort((a, b) => dark[b] - dark[a]);
  const take = Math.max(4, Math.round(blocks * 0.002));
  const total = [0, 0, 0];
  let n = 0;
  for (const b of order.slice(0, take)) {
    const c = Math.max(1, counts[b]) * max;
    total[0] += sums[b * 3] / c; total[1] += sums[b * 3 + 1] / c; total[2] += sums[b * 3 + 2] / c; n += 1;
  }
  return total.map((v) => Math.max(MIN_AIRLIGHT, v / Math.max(1, n))) as [number, number, number];
}

/** Dehaze display-encoded samples in place: RGBA 8-bit (stride 4, max 255) or RGB 16-bit (stride 3, max 65535). */
export function applyDehaze(pixels: Uint8ClampedArray | Uint16Array, width: number, height: number, stride: 3 | 4, max: number, amount: number | undefined, imageEdge = Math.max(width, height)): void {
  if (!validDehaze(amount) || amount === 0 || !width || !height) return;
  const count = width * height;
  const dark = new Float32Array(count);
  for (let p = 0, i = 0; p < count; p += 1, i += stride) dark[p] = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) / max;
  const A = airlight(pixels, width, height, stride, max);
  const peak = Math.max(A[0], A[1], A[2]);
  if (amount < 0) {
    const k = -amount * ADD_STRENGTH;
    for (let p = 0, i = 0; p < count; p += 1, i += stride) {
      // Haze is thicker where the picture is already lighter; a flat veil would just lower contrast.
      const w = k * (0.4 + 0.6 * dark[p]);
      for (let c = 0; c < 3; c += 1) pixels[i + c] = Math.round(Math.min(max, Math.max(0, pixels[i + c] + (A[c] * max - pixels[i + c]) * w)));
    }
    return;
  }
  const soft = boxBlur(dark, width, height, Math.max(1, DARK_RADIUS * imageEdge));
  const omega = amount * STRENGTH;
  for (let p = 0, i = 0; p < count; p += 1, i += stride) {
    // The smaller of the softened and the pixel's own dark channel avoids dark halos round light subjects.
    const t = Math.max(MIN_TRANSMISSION, 1 - omega * Math.min(soft[p], dark[p]) / peak);
    for (let c = 0; c < 3; c += 1) {
      const value = (pixels[i + c] / max - A[c]) / t + A[c];
      pixels[i + c] = Math.round(Math.min(1, Math.max(0, value)) * max);
    }
  }
}

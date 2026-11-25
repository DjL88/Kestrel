/**
 * Dehaze (standard editor, 25 Nov 2026): a dark-channel haze model. Haze adds a veil of the sky's colour that grows
 * with distance; we estimate that colour (the airlight) from the haziest pixels, estimate how much veil each area
 * has from a softened dark channel, and take it away (positive amount) or add more (negative). It runs first, on the
 * picture's own pixels, before tone, like noise reduction. It makes no claim to recover detail that is not there.
 *
 * Known limit: the airlight is estimated from the pixels being edited, so a zoomed-in strip can differ slightly from
 * the whole-photo preview and the export, which agree with each other.
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

/** Dehaze display-encoded samples in place: RGBA 8-bit (stride 4, max 255) or RGB 16-bit (stride 3, max 65535). */
export function applyDehaze(pixels: Uint8ClampedArray | Uint16Array, width: number, height: number, stride: 3 | 4, max: number, amount: number | undefined, imageEdge = Math.max(width, height)): void {
  if (!validDehaze(amount) || amount === 0 || !width || !height) return;
  const count = width * height;
  const dark = new Float32Array(count);
  const BINS = 1024;
  const histogram = new Uint32Array(BINS);
  for (let p = 0, i = 0; p < count; p += 1, i += stride) {
    const d = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) / max;
    dark[p] = d;
    histogram[Math.min(BINS - 1, Math.floor(d * BINS))] += 1;
  }
  // Airlight: the mean colour of the 0.1% of pixels with the brightest dark channel (the haziest, not just the whitest).
  let threshold = BINS - 1;
  for (let seen = 0, want = Math.max(1, count * 0.001); threshold > 0; threshold -= 1) { seen += histogram[threshold]; if (seen >= want) break; }
  const airlight = [0, 0, 0];
  let n = 0;
  for (let p = 0, i = 0; p < count; p += 1, i += stride) {
    if (Math.floor(dark[p] * BINS) < threshold) continue;
    airlight[0] += pixels[i]; airlight[1] += pixels[i + 1]; airlight[2] += pixels[i + 2]; n += 1;
  }
  const A = airlight.map((v) => Math.max(MIN_AIRLIGHT, v / Math.max(1, n) / max));
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

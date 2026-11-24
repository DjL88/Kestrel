/**
 * Tone curve and colour mixer: the two editing controls every major editor has and Kestrel lacked (gap analysis,
 * 24 Nov 2026). Pure maths shared by the CPU path (photoEdits.ts tonePixel), the 16-bit export and the GPU shader
 * (webglEdit.ts), so preview and export cannot drift apart.
 *
 * Tone curve: points on display-encoded values (0 to 1), joined by a monotone cubic (Fritsch–Carlson), so the curve
 * never overshoots between points and never reverses tones unless the person drags a point below its neighbour's
 * height. It is applied to each channel after contrast, like the RGB curve in other editors.
 *
 * Colour mixer: eight hue bands (red, orange, yellow, green, aqua, blue, purple, magenta), each with hue, saturation
 * and luminance from -2 to 2. Adjacent bands blend smoothly, and greys and near-greys are left alone, so a band never
 * tints a neutral sky or white plumage.
 */

/** A curve point: [input, output], both display-encoded 0 to 1. */
export type CurvePoint = [number, number];

export const MIXER_BANDS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const;
export type MixerBand = typeof MIXER_BANDS[number];
/** Band centres in degrees of hue. Uneven on purpose: skin, plumage and foliage sit in the warm half. */
export const MIXER_CENTRES = [0, 30, 60, 120, 180, 240, 270, 300] as const;

export interface ColourMixer {
  /** One value per band, in MIXER_BANDS order, -2 to 2. */
  hue: number[];
  saturation: number[];
  luminance: number[];
}

export const MAX_CURVE_POINTS = 16;
/** Entries in the sampled curve. The CPU and the GPU read the same table, so they agree exactly. */
export const CURVE_LUT_SIZE = 513;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** A usable curve: 2 to 16 points inside 0 to 1, inputs strictly increasing. Anything else is refused, never guessed. */
export function validCurve(value: unknown): value is CurvePoint[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_CURVE_POINTS) return false;
  let previous = -1;
  for (const point of value) {
    if (!Array.isArray(point) || point.length !== 2) return false;
    const [x, y] = point;
    if (!finite(x) || !finite(y) || x < 0 || x > 1 || y < 0 || y > 1 || x <= previous) return false;
    previous = x;
  }
  return true;
}

export function validMixer(value: unknown): value is ColourMixer {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const mixer = value as Record<string, unknown>;
  if (Object.keys(mixer).some((key) => key !== 'hue' && key !== 'saturation' && key !== 'luminance')) return false;
  return (['hue', 'saturation', 'luminance'] as const).every((key) => {
    const list = mixer[key];
    return Array.isArray(list) && list.length === MIXER_BANDS.length && list.every((v) => finite(v) && v >= -2 && v <= 2);
  });
}

/** Absent, a straight line, or malformed (which every renderer ignores and the 16-bit export refuses). */
export function isNeutralCurve(curve: unknown): boolean {
  return !validCurve(curve) || curve.every(([x, y]) => Math.abs(x - y) < 1e-6);
}

/** Absent, all zero, or malformed (ignored by every renderer, refused by the 16-bit export). */
export function isNeutralMixer(mixer: unknown): boolean {
  return !validMixer(mixer) || [mixer.hue, mixer.saturation, mixer.luminance].every((list) => list.every((v) => v === 0));
}

export const NEUTRAL_MIXER = (): ColourMixer => ({
  hue: MIXER_BANDS.map(() => 0), saturation: MIXER_BANDS.map(() => 0), luminance: MIXER_BANDS.map(() => 0),
});

/**
 * Sample the curve into a table of CURVE_LUT_SIZE entries over 0 to 1. Below the first point and above the last the
 * curve is flat, as in other editors (a raised black point lifts everything darker than it to that level).
 */
export function curveLut(points: CurvePoint[]): Float32Array {
  const n = points.length;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i += 1) slopes.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  // Fritsch–Carlson tangents: monotone between points, no overshoot.
  const tangents = new Array<number>(n).fill(0);
  tangents[0] = slopes[0];
  tangents[n - 1] = slopes[n - 2];
  for (let i = 1; i < n - 1; i += 1) tangents[i] = slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2;
  for (let i = 0; i < n - 1; i += 1) {
    if (slopes[i] === 0) { tangents[i] = 0; tangents[i + 1] = 0; continue; }
    const a = tangents[i] / slopes[i];
    const b = tangents[i + 1] / slopes[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      tangents[i] = t * a * slopes[i];
      tangents[i + 1] = t * b * slopes[i];
    }
  }
  const lut = new Float32Array(CURVE_LUT_SIZE);
  let segment = 0;
  for (let k = 0; k < CURVE_LUT_SIZE; k += 1) {
    const x = k / (CURVE_LUT_SIZE - 1);
    let y: number;
    if (x <= xs[0]) y = ys[0];
    else if (x >= xs[n - 1]) y = ys[n - 1];
    else {
      while (segment < n - 2 && x > xs[segment + 1]) segment += 1;
      const width = xs[segment + 1] - xs[segment];
      const t = (x - xs[segment]) / width;
      const t2 = t * t;
      const t3 = t2 * t;
      y = (2 * t3 - 3 * t2 + 1) * ys[segment] + (t3 - 2 * t2 + t) * width * tangents[segment]
        + (-2 * t3 + 3 * t2) * ys[segment + 1] + (t3 - t2) * width * tangents[segment + 1];
    }
    lut[k] = Math.min(1, Math.max(0, y));
  }
  return lut;
}

/** Read the table with linear interpolation. Input is clamped to 0 to 1. */
export function applyCurveLut(value: number, lut: Float32Array): number {
  if (!(value > 0)) return lut[0];
  if (value >= 1) return lut[lut.length - 1];
  const at = value * (lut.length - 1);
  const low = Math.floor(at);
  return lut[low] + (lut[low + 1] - lut[low]) * (at - low);
}

/** How far each unit of the sliders moves the colour. -2 to 2 on every control. */
export const MIXER_HUE_DEGREES = 15;
export const MIXER_SATURATION = 0.5;
export const MIXER_LUMINANCE_EV = 0.5;

/** The mixer as 24 numbers (hue, saturation, luminance per band), the shape the shader takes. */
export function mixerParams(mixer: ColourMixer): Float32Array {
  const params = new Float32Array(24);
  for (let i = 0; i < 8; i += 1) {
    params[i] = mixer.hue[i];
    params[8 + i] = mixer.saturation[i];
    params[16 + i] = mixer.luminance[i];
  }
  return params;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const smoothstep = (low: number, high: number, x: number) => smooth(Math.min(1, Math.max(0, (x - low) / (high - low))));

/** HSV hue in degrees (0 to 360) of three non-negative values whose spread is `delta` (> 0). */
function hueOf(red: number, green: number, blue: number, high: number, delta: number): number {
  let hue: number;
  if (high === red) hue = 60 * (((green - blue) / delta) % 6);
  else if (high === green) hue = 60 * ((blue - red) / delta + 2);
  else hue = 60 * ((red - green) / delta + 4);
  return hue < 0 ? hue + 360 : hue;
}

/**
 * Apply the mixer to one linear-light pixel (written to `out`). The band a colour belongs to, and how grey it is, are
 * judged on display values (what the person sees: an orange looks orange), and the change is made on linear light in
 * HSV, so it is the same at 8 and 16 bits. Values above 1 (kept highlights) stay above 1. Greys are untouched.
 * `encode` turns linear light into display values (photoEdits passes its own encodeLinear).
 */
export function mixPixel(red: number, green: number, blue: number, params: Float32Array, out: Float32Array, encode: (v: number) => number = defaultEncode): void {
  red = Math.max(0, red);
  green = Math.max(0, green);
  blue = Math.max(0, blue);
  const er = encode(red);
  const eg = encode(green);
  const eb = encode(blue);
  const eHigh = Math.max(er, eg, eb);
  const eDelta = eHigh - Math.min(er, eg, eb);
  const guard = smoothstep(0.02, 0.15, eHigh > 0 ? eDelta / eHigh : 0);
  const high = Math.max(red, green, blue);
  const delta = high - Math.min(red, green, blue);
  if (guard === 0 || delta <= 0) {
    out[0] = red; out[1] = green; out[2] = blue;
    return;
  }
  const seen = hueOf(er, eg, eb, eHigh, eDelta);
  // Find the two bands either side of the seen hue and blend them smoothly.
  let index = 7;
  for (let i = 0; i < 7; i += 1) if (seen >= MIXER_CENTRES[i] && seen < MIXER_CENTRES[i + 1]) { index = i; break; }
  const start = MIXER_CENTRES[index];
  const end = index === 7 ? 360 : MIXER_CENTRES[index + 1];
  const t = smooth((seen - start) / (end - start));
  const next = (index + 1) % 8;
  const hueShift = (params[index] * (1 - t) + params[next] * t) * guard;
  const satShift = (params[8 + index] * (1 - t) + params[8 + next] * t) * guard;
  const lumShift = (params[16 + index] * (1 - t) + params[16 + next] * t) * guard;
  const hue = hueOf(red, green, blue, high, delta);
  const newHue = (((hue + hueShift * MIXER_HUE_DEGREES) % 360) + 360) % 360;
  const newSat = Math.min(1, Math.max(0, (delta / high) * (1 + satShift * MIXER_SATURATION)));
  const value = high * 2 ** (lumShift * MIXER_LUMINANCE_EV);
  // HSV back to RGB.
  const c = value * newSat;
  const h = newHue / 60;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = value - c;
  let r = 0; let g = 0; let b = 0;
  if (h < 1) { r = c; g = x; } else if (h < 2) { r = x; g = c; } else if (h < 3) { g = c; b = x; }
  else if (h < 4) { g = x; b = c; } else if (h < 5) { r = x; b = c; } else { r = c; b = x; }
  out[0] = r + m; out[1] = g + m; out[2] = b + m;
}

function defaultEncode(value: number): number {
  if (!(value > 0)) return 0;
  if (value >= 1) return 1;
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}

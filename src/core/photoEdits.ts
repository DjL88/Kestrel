import { hasActiveMasks, type Mask } from './maskTypes';
/** Optional tonal controls. Each runs from -2 to 2 and an absent value means 0. */
export const TONE_CONTROLS = [
  { key: 'brightness', label: 'Brightness' },
  { key: 'contrast', label: 'Contrast' },
  { key: 'highlights', label: 'Highlights' },
  { key: 'shadows', label: 'Shadows' },
  { key: 'whites', label: 'Whites' },
  { key: 'blacks', label: 'Blacks' },
  { key: 'vibrance', label: 'Vibrance' },
] as const;
export const DETAIL_CONTROLS = [
  { key: 'texture', label: 'Texture' },
  { key: 'clarity', label: 'Clarity' },
  { key: 'sharpen', label: 'Sharpening' },
] as const;
export type ToneKey = (typeof TONE_CONTROLS)[number]['key'];

export type ToneCurvePoint = readonly [number, number];

export const DEFAULT_TONE_CURVE: readonly ToneCurvePoint[] = [
  [0, 0],
  [0.25, 0.25],
  [0.5, 0.5],
  [0.75, 0.75],
  [1, 1],
];

export interface PhotoEdit {
  exposure: number;
  warmth: number;
  /** Green (-2) to Magenta (+2) white balance tint axis. Absent/0 = neutral. */
  tint?: number;
  colour: number;
  /** Perceptual midtone adjustment, distinct from exposure EV. Absent in older projects = neutral. */
  brightness?: number;
  contrast?: number;
  highlights?: number;
  shadows?: number;
  whites?: number;
  blacks?: number;
  vibrance?: number;
  /** Parametric/point tone curve points in [0, 1]. Evaluated via monotonic cubic Hermite spline. */
  toneCurve?: [number, number][];
  texture?: number;
  clarity?: number;
  sharpen?: number;
  /** Colour noise reduction, 0 (off) to 2. Runs first, on the original pixels, before tone and sharpening. */
  denoise?: number;
  /** Local adjustments. They run after the whole-photo edit, in order. */
  masks?: Mask[];
}

export const DEFAULT_EDIT: PhotoEdit = { exposure: 0, warmth: 0, colour: 0 };

export const EDIT_CHOICES = [
  { key: 'exposure', label: 'Exposure', options: ['Darker', 'Neutral', 'Brighter'] },
  { key: 'warmth', label: 'Warmth', options: ['Cooler', 'Neutral', 'Warmer'] },
  { key: 'colour', label: 'Colour', options: ['Softer', 'Neutral', 'Richer'] },
] as const;

export function validToneCurve(value: unknown): value is [number, number][] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 16) return false;
  let prevX = -1;
  for (const pt of value) {
    if (!Array.isArray(pt) || pt.length !== 2) return false;
    const [x, y] = pt;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (x < 0 || x > 1 || y < 0 || y > 1 || x <= prevX) return false;
    prevX = x;
  }
  return value[0][0] === 0 && value[value.length - 1][0] === 1;
}

export function isIdentityToneCurve(curve: readonly ToneCurvePoint[] | undefined): boolean {
  if (!curve || curve.length < 2) return true;
  return curve.every(([x, y]) => Math.abs(x - y) < 1e-4);
}

/**
 * Evaluate normalized tone-curve control points into a strictly monotonic 0..1 LUT
 * using Fritsch-Carlson monotone cubic Hermite interpolation (never overshoots).
 */
export function evaluateToneCurveLut(curve: readonly ToneCurvePoint[] | undefined, size = 256): Float32Array {
  const lut = new Float32Array(size);
  if (!curve || curve.length < 2 || isIdentityToneCurve(curve)) {
    for (let i = 0; i < size; i += 1) lut[i] = i / (size - 1);
    return lut;
  }
  const pts = [...curve]
    .map(([x, y]) => [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  if (pts[0][0] > 0) pts.unshift([0, pts[0][1]]);
  if (pts[pts.length - 1][0] < 1) pts.push([1, pts[pts.length - 1][1]]);
  // Enforce non-decreasing knot x spacing
  const dedup: [number, number][] = [];
  for (const pt of pts) {
    if (!dedup.length || pt[0] - dedup[dedup.length - 1][0] > 1e-5) dedup.push(pt);
    else dedup[dedup.length - 1] = pt;
  }
  const n = dedup.length;
  if (n < 2) {
    for (let i = 0; i < size; i += 1) lut[i] = i / (size - 1);
    return lut;
  }
  const dx = new Float64Array(n - 1);
  const dy = new Float64Array(n - 1);
  const slopes = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i += 1) {
    dx[i] = dedup[i + 1][0] - dedup[i][0];
    dy[i] = dedup[i + 1][1] - dedup[i][1];
    slopes[i] = dx[i] > 0 ? dy[i] / dx[i] : 0;
  }
  const tangents = new Float64Array(n);
  tangents[0] = slopes[0];
  tangents[n - 1] = slopes[n - 2];
  for (let i = 1; i < n - 1; i += 1) {
    if (slopes[i - 1] * slopes[i] <= 0) {
      tangents[i] = 0;
    } else {
      tangents[i] = (slopes[i - 1] + slopes[i]) * 0.5;
    }
  }
  for (let i = 0; i < n - 1; i += 1) {
    if (Math.abs(slopes[i]) < 1e-9) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
    } else {
      const a = tangents[i] / slopes[i];
      const b = tangents[i + 1] / slopes[i];
      const h = Math.hypot(a, b);
      if (h > 3) {
        const scale = 3 / h;
        tangents[i] = scale * a * slopes[i];
        tangents[i + 1] = scale * b * slopes[i];
      }
    }
  }
  let seg = 0;
  for (let i = 0; i < size; i += 1) {
    const x = i / (size - 1);
    while (seg < n - 2 && x > dedup[seg + 1][0]) seg += 1;
    const h = Math.max(1e-7, dx[seg]);
    const t = Math.min(1, Math.max(0, (x - dedup[seg][0]) / h));
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    const y = h00 * dedup[seg][1] + h10 * h * tangents[seg] + h01 * dedup[seg + 1][1] + h11 * h * tangents[seg + 1];
    lut[i] = Math.min(1, Math.max(0, y));
  }
  return lut;
}

export function isNeutralTone(edit: PhotoEdit): boolean {
  return (
    edit.exposure === 0 &&
    edit.warmth === 0 &&
    !(edit.tint ?? 0) &&
    edit.colour === 0 &&
    TONE_CONTROLS.every(({ key }) => !edit[key]) &&
    isIdentityToneCurve(edit.toneCurve)
  );
}

export const NOISE_CONTROL = { key: 'denoise', label: 'Noise reduction' } as const;

export function isNeutralEdit(edit: PhotoEdit): boolean {
  return !edit.denoise && isNeutralTone(edit) && DETAIL_CONTROLS.every(({ key }) => !edit[key]) && !hasActiveMasks(edit.masks);
}

/** Nothing to keep: neutral, and no masks at all (an empty mask is still kept so it can be adjusted). */
export function isEmptyEdit(edit: PhotoEdit): boolean {
  return isNeutralEdit(edit) && !edit.masks?.length;
}

/** Neutral apart from any local masks. Decides whether the whole-photo passes need to run. */
export function isNeutralGlobal(edit: PhotoEdit): boolean {
  return isNeutralTone(edit) && DETAIL_CONTROLS.every(({ key }) => !edit[key]);
}

export const srgbChannelToLinear = (encoded01: number): number => {
  const v = Math.min(1, Math.max(0, encoded01));
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

export const linearChannelToSrgb = (linear01: number): number => {
  const v = Math.min(1, Math.max(0, linear01));
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
};

const linear = Array.from({ length: 256 }, (_, index) => srgbChannelToLinear(index / 255));
const encoded = Uint8ClampedArray.from({ length: 4096 }, (_, index) => 255 * linearChannelToSrgb(index / 4095));
const encodedUnit = Float32Array.from(encoded, (value) => value / 255);
const toUnit = (value: number) => encodedUnit[Math.min(4095, Math.max(0, Math.round(value * 4095)))];

const MIDTONE_TABLE_SIZE = 16384;
const encodeLuma = Float32Array.from({ length: MIDTONE_TABLE_SIZE + 1 }, (_, i) => linearChannelToSrgb(i / MIDTONE_TABLE_SIZE));
const decodeLuma = Float32Array.from({ length: MIDTONE_TABLE_SIZE + 1 }, (_, i) => srgbChannelToLinear(i / MIDTONE_TABLE_SIZE));
const fromLinearLuma = (value: number) => encodeLuma[Math.min(MIDTONE_TABLE_SIZE, Math.max(0, Math.round(value * MIDTONE_TABLE_SIZE)))];
const toLinearLuma = (value: number) => decodeLuma[Math.min(MIDTONE_TABLE_SIZE, Math.max(0, Math.round(value * MIDTONE_TABLE_SIZE)))];
const smoothstep = (low: number, high: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - low) / (high - low)));
  return t * t * (3 - 2 * t);
};
const toByte = (value: number) => encoded[Math.min(4095, Math.max(0, Math.round(value * 4095)))];

/**
 * Computes Temperature (warmth) & Green/Magenta (tint) slider values from a neutral 0..255 sRGB sample
 * for the White Balance Eyedropper tool. Clamps safely to slider range [-2, 2].
 */
export function computeWbFromNeutralSample(rByte: number, gByte: number, bByte: number): { warmth: number; tint: number } {
  const lr = Math.max(1e-4, srgbChannelToLinear(rByte / 255));
  const lg = Math.max(1e-4, srgbChannelToLinear(gByte / 255));
  const lb = Math.max(1e-4, srgbChannelToLinear(bByte / 255));
  const clampSlider = (v: number) => Math.max(-2, Math.min(2, Math.round(v * 20) / 20));
  const w = (lb - lr) / (lb + lr);
  const warmth = clampSlider(w / 0.08);
  const equalRb = (2 * lr * lb) / (lr + lb);
  const t = (lg - equalRb) / (lg + 0.45 * equalRb);
  const tint = clampSlider(t / 0.08);
  return { warmth, tint };
}

/** Luminance- and hue-preserving filmic soft shoulder for scene-linear values exceeding display peak 1.0. */
export function rollOffHighlights(r: number, g: number, b: number): [number, number, number] {
  const peak = Math.max(r, g, b);
  if (peak <= 1.0) return [r, g, b];
  const scale = 1.0 / peak;
  const sr = r * scale;
  const sg = g * scale;
  const sb = b * scale;
  const lum = Math.min(1.0, 0.2126 * r + 0.7152 * g + 0.0722 * b);
  const desat = Math.min(0.45, ((peak - 1.0) / (peak + 0.85)) * 0.65);
  return [
    sr + (lum - sr) * desat,
    sg + (lum - sg) * desat,
    sb + (lum - sb) * desat,
  ];
}

/** Shader-ready constants. The CPU path and the GPU shader both read these, so they cannot drift apart. */
export function editParams(edit: PhotoEdit) {
  return {
    gain: 2 ** (edit.exposure * 0.4),
    // A bounded monotonic midtone curve: pure black and white stay in place,
    // unlike exposure which multiplies scene-linear light in EV stops.
    brightness: (edit.brightness ?? 0) * 0.11,
    warmth: edit.warmth * 0.08,
    tint: (edit.tint ?? 0) * 0.08,
    // Colour -2 is fully monochrome. Other slider positions keep their existing scale.
    colour: edit.colour === -2 ? -1 : edit.colour * 0.2,
    contrast: 1 + (edit.contrast ?? 0) * 0.35,
    contrastAmount: (edit.contrast ?? 0) * 0.9,
    highlights: (edit.highlights ?? 0) * 0.3,
    shadows: (edit.shadows ?? 0) * 0.3,
    blackPoint: -(edit.blacks ?? 0) * 0.02,
    whitePoint: 1 - (edit.whites ?? 0) * 0.08,
    vibrance: (edit.vibrance ?? 0) * 0.3,
  };
}
export type EditParams = ReturnType<typeof editParams>;

export function wbMultipliers(warmth: number, tint: number): [number, number, number] {
  if (tint === 0) return [1 + warmth, 1, 1 - warmth];
  const rb = 1 + tint * 0.45;
  const g = 1 - tint;
  const lumNorm = Math.max(0.25, 0.2126 * rb + 0.7152 * g + 0.0722 * rb);
  return [((1 + warmth) * rb) / lumNorm, g / lumNorm, ((1 - warmth) * rb) / lumNorm];
}

export function hasDetail(edit: PhotoEdit): boolean {
  return DETAIL_CONTROLS.some(({ key }) => !!edit[key]);
}

/** Detail scales are fractions of the whole image's long edge, so preview, zoom and export agree. */
export function detailParams(edit: PhotoEdit, imageEdge: number) {
  const radius = (fraction: number, minimum: number) => Math.max(minimum, Math.round(imageEdge * fraction));
  return {
    sharpen: (edit.sharpen ?? 0) * 0.4, sharpenRadius: radius(0.0004, 1),
    texture: (edit.texture ?? 0) * 0.3, textureRadius: radius(0.0015, 2),
    clarity: (edit.clarity ?? 0) * 0.35, clarityRadius: radius(0.006, 6),
  };
}

export function boxBlurFloat(source: Float32Array, width: number, height: number, radius: number): Float32Array {
  const temp = new Float32Array(source.length);
  const out = new Float32Array(source.length);
  const windowSize = 2 * radius + 1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    for (let k = -radius; k <= radius; k += 1) sum += source[row + Math.min(width - 1, Math.max(0, k))];
    for (let x = 0; x < width; x += 1) {
      temp[row + x] = sum / windowSize;
      sum += source[row + Math.min(width - 1, x + radius + 1)] - source[row + Math.max(0, x - radius)];
    }
  }
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let k = -radius; k <= radius; k += 1) sum += temp[Math.min(height - 1, Math.max(0, k)) * width + x];
    for (let y = 0; y < height; y += 1) {
      out[y * width + x] = sum / windowSize;
      sum += temp[Math.min(height - 1, y + radius + 1) * width + x] - temp[Math.max(0, y - radius) * width + x];
    }
  }
  return out;
}

/** Hue-preserving luminance-ratio detail adjustment on Float32 display-referred RGBA [0..1]. */
export function applyDetailFloat(rgba: Float32Array, width: number, height: number, edit: PhotoEdit, imageEdge: number): void {
  if (!hasDetail(edit)) return;
  const d = detailParams(edit, imageEdge);
  const count = width * height;
  const luma = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const j = i * 4;
    luma[i] = 0.2126 * rgba[j] + 0.7152 * rgba[j + 1] + 0.0722 * rgba[j + 2];
  }
  const sharpBlur = d.sharpen ? boxBlurFloat(luma, width, height, d.sharpenRadius) : null;
  const textureBlur = d.texture ? boxBlurFloat(luma, width, height, d.textureRadius) : null;
  const clarityBlur = d.clarity ? boxBlurFloat(luma, width, height, d.clarityRadius) : null;
  for (let i = 0; i < count; i += 1) {
    const l = luma[i];
    let add = 0;
    if (sharpBlur) add += d.sharpen * (l - sharpBlur[i]);
    if (textureBlur) add += d.texture * (l - textureBlur[i]);
    if (clarityBlur) add += d.clarity * 4 * l * (1 - l) * (l - clarityBlur[i]);
    if (add === 0) continue;
    const j = i * 4;
    const denom = l > 0.02 ? l : 0;
    if (denom > 0) {
      const rScale = Math.min(3, rgba[j] / denom);
      const gScale = Math.min(3, rgba[j + 1] / denom);
      const bScale = Math.min(3, rgba[j + 2] / denom);
      rgba[j] = Math.min(1, Math.max(0, rgba[j] + add * rScale));
      rgba[j + 1] = Math.min(1, Math.max(0, rgba[j + 1] + add * gScale));
      rgba[j + 2] = Math.min(1, Math.max(0, rgba[j + 2] + add * bScale));
    } else {
      rgba[j] = Math.min(1, Math.max(0, rgba[j] + add));
      rgba[j + 1] = Math.min(1, Math.max(0, rgba[j + 1] + add));
      rgba[j + 2] = Math.min(1, Math.max(0, rgba[j + 2] + add));
    }
  }
}

/** CPU reference for texture, clarity and sharpening. Preserves chromaticity across hues while matching neutral greys cleanly. */
export function applyDetail(pixels: Uint8ClampedArray, width: number, height: number, edit: PhotoEdit, imageEdge: number): void {
  if (!hasDetail(edit)) return;
  const d = detailParams(edit, imageEdge);
  const count = width * height;
  const luma = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    luma[i] = (0.2126 * pixels[i * 4] + 0.7152 * pixels[i * 4 + 1] + 0.0722 * pixels[i * 4 + 2]) / 255;
  }
  const sharpBlur = d.sharpen ? boxBlurFloat(luma, width, height, d.sharpenRadius) : null;
  const textureBlur = d.texture ? boxBlurFloat(luma, width, height, d.textureRadius) : null;
  const clarityBlur = d.clarity ? boxBlurFloat(luma, width, height, d.clarityRadius) : null;
  for (let i = 0; i < count; i += 1) {
    const l = luma[i];
    let add = 0;
    if (sharpBlur) add += d.sharpen * (l - sharpBlur[i]);
    if (textureBlur) add += d.texture * (l - textureBlur[i]);
    if (clarityBlur) add += d.clarity * 4 * l * (1 - l) * (l - clarityBlur[i]);
    if (add === 0) continue;
    const j = i * 4;
    const r0 = pixels[j] / 255;
    const g0 = pixels[j + 1] / 255;
    const b0 = pixels[j + 2] / 255;
    if (l > 0.02) {
      pixels[j] = Math.round(Math.min(1, Math.max(0, r0 + add * Math.min(3, r0 / l))) * 255);
      pixels[j + 1] = Math.round(Math.min(1, Math.max(0, g0 + add * Math.min(3, g0 / l))) * 255);
      pixels[j + 2] = Math.round(Math.min(1, Math.max(0, b0 + add * Math.min(3, b0 / l))) * 255);
    } else {
      pixels[j] = Math.round(Math.min(1, Math.max(0, r0 + add)) * 255);
      pixels[j + 1] = Math.round(Math.min(1, Math.max(0, g0 + add)) * 255);
      pixels[j + 2] = Math.round(Math.min(1, Math.max(0, b0 + add)) * 255);
    }
  }
}

const sCurve = (x: number, amount: number): number => {
  const c = Math.min(1, Math.max(0, x));
  return Math.min(1, Math.max(0, c + amount * c * (1 - c) * (c - 0.5)));
};

const lookupCurve = (lut: Float32Array, x: number): number => {
  const scaled = Math.min(1, Math.max(0, x)) * (lut.length - 1);
  const idx = Math.floor(scaled);
  const frac = scaled - idx;
  if (idx >= lut.length - 1) return lut[lut.length - 1];
  return lut[idx] + (lut[idx + 1] - lut[idx]) * frac;
};

/** Converts sRGB 8-bit RGBA image bytes to scene-linear Float32Array RGBA (alpha unchanged in [0..1]). */
export function rgbaBytesToLinearFloat(pixels: Uint8ClampedArray): Float32Array {
  const out = new Float32Array(pixels.length);
  for (let i = 0; i < pixels.length; i += 4) {
    out[i] = linear[pixels[i]];
    out[i + 1] = linear[pixels[i + 1]];
    out[i + 2] = linear[pixels[i + 2]];
    out[i + 3] = pixels[i + 3] / 255;
  }
  return out;
}

/** Encodes display-referred Float32Array [0..1] back to 8-bit RGBA bytes once at the end of pipeline. */
export function displayFloatToRgbaBytes(floatRgba: Float32Array, out: Uint8ClampedArray): void {
  for (let i = 0; i < out.length; i += 4) {
    out[i] = Math.round(Math.min(1, Math.max(0, floatRgba[i])) * 255);
    out[i + 1] = Math.round(Math.min(1, Math.max(0, floatRgba[i + 1])) * 255);
    out[i + 2] = Math.round(Math.min(1, Math.max(0, floatRgba[i + 2])) * 255);
    out[i + 3] = Math.round(Math.min(1, Math.max(0, floatRgba[i + 3])) * 255);
  }
}

/** Encodes scene-linear Float32Array (neutral / unedited) to display-referred [0..1] in-place. */
export function linearFloatToDisplayInPlace(rgba: Float32Array): void {
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = toUnit(rgba[i]);
    rgba[i + 1] = toUnit(rgba[i + 1]);
    rgba[i + 2] = toUnit(rgba[i + 2]);
  }
}

/**
 * Applies global colour & tone adjustments to an interleaved scene-linear Float32Array RGBA buffer,
 * writing display-referred sRGB floats [0..1] back in-place (zero intermediate 8-bit quantization).
 */
export function applyPhotoEditLinearInPlace(rgba: Float32Array, edit: PhotoEdit): void {
  if (isNeutralTone(edit)) {
    linearFloatToDisplayInPlace(rgba);
    return;
  }
  const { gain, brightness, warmth, tint, colour, contrastAmount, highlights, shadows, blackPoint, whitePoint, vibrance } = editParams(edit);
  const [rMul, gMul, bMul] = wbMultipliers(warmth, tint);
  const tonal = highlights !== 0 || shadows !== 0 || blackPoint !== 0 || whitePoint !== 1;
  const curvedContrast = contrastAmount !== 0;
  const hasToneCurve = !isIdentityToneCurve(edit.toneCurve);
  const curveLut = hasToneCurve ? evaluateToneCurveLut(edit.toneCurve, 256) : null;
  const range = whitePoint - blackPoint;
  const monochrome = colour === -1;

  for (let index = 0; index < rgba.length; index += 4) {
    let red = rgba[index] * gain * rMul;
    let green = rgba[index + 1] * gain * gMul;
    let blue = rgba[index + 2] * gain * bMul;
    if (tonal) {
      red = (red - blackPoint) / range;
      green = (green - blackPoint) / range;
      blue = (blue - blackPoint) / range;
      const rawLuma = Math.max(0, 0.2126 * red + 0.7152 * green + 0.0722 * blue);
      const perceived = rawLuma <= 1 ? fromLinearLuma(rawLuma) : 1 + 0.25 * Math.log2(rawLuma);
      const factor = Math.max(
        0,
        1 + shadows * (1 - smoothstep(0, 0.6, perceived)) + highlights * smoothstep(0.35, 1.1, perceived),
      );
      red *= factor;
      green *= factor;
      blue *= factor;
    }
    let luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    if (brightness !== 0 && luminance > 0 && luminance < 1) {
      const p = fromLinearLuma(luminance);
      const lifted = p + 4 * brightness * p * (1 - p);
      const requestedFactor = toLinearLuma(lifted) / luminance;
      const peak = Math.max(red, green, blue);
      const factor = requestedFactor > 1 && peak > 0
        ? Math.min(requestedFactor, Math.max(1, 0.992 / peak))
        : requestedFactor;
      red *= factor;
      green *= factor;
      blue *= factor;
      luminance *= factor;
    }
    let saturation = monochrome ? 0 : 1 + colour;
    if (!monochrome && vibrance !== 0) {
      const high = Math.max(red, green, blue);
      const chroma = high > 0 ? (high - Math.min(red, green, blue)) / high : 0;
      saturation += vibrance * (1 - Math.min(1, chroma));
    }
    let outRed = Math.max(0, luminance + (red - luminance) * saturation);
    let outGreen = Math.max(0, luminance + (green - luminance) * saturation);
    let outBlue = Math.max(0, luminance + (blue - luminance) * saturation);
    [outRed, outGreen, outBlue] = rollOffHighlights(outRed, outGreen, outBlue);

    let eR = linearChannelToSrgb(outRed);
    let eG = linearChannelToSrgb(outGreen);
    let eB = linearChannelToSrgb(outBlue);
    if (curvedContrast) {
      eR = sCurve(eR, contrastAmount);
      eG = sCurve(eG, contrastAmount);
      eB = sCurve(eB, contrastAmount);
    }
    if (curveLut) {
      eR = lookupCurve(curveLut, eR);
      eG = lookupCurve(curveLut, eG);
      eB = lookupCurve(curveLut, eB);
    }
    rgba[index] = eR;
    rgba[index + 1] = eG;
    rgba[index + 2] = eB;
  }
}

/** Apply adjustments to a browser-decoded sRGB image. Shared maths for preview, export and tests. */
export function applyPhotoEdit(pixels: Uint8ClampedArray, edit: PhotoEdit): void {
  if (isNeutralTone(edit)) return;
  const { gain, brightness, warmth, tint, colour, contrastAmount, highlights, shadows, blackPoint, whitePoint, vibrance } = editParams(edit);
  const [rMul, gMul, bMul] = wbMultipliers(warmth, tint);
  const tonal = highlights !== 0 || shadows !== 0 || blackPoint !== 0 || whitePoint !== 1;
  const curved = contrastAmount !== 0;
  const hasToneCurve = !isIdentityToneCurve(edit.toneCurve);
  const curveLut = hasToneCurve ? evaluateToneCurveLut(edit.toneCurve, 256) : null;
  const range = whitePoint - blackPoint;
  const monochrome = colour === -1;

  for (let index = 0; index < pixels.length; index += 4) {
    let red = linear[pixels[index]] * gain * rMul;
    let green = linear[pixels[index + 1]] * gain * gMul;
    let blue = linear[pixels[index + 2]] * gain * bMul;
    if (tonal) {
      red = (red - blackPoint) / range;
      green = (green - blackPoint) / range;
      blue = (blue - blackPoint) / range;
      const rawLuma = Math.max(0, 0.2126 * red + 0.7152 * green + 0.0722 * blue);
      const perceived = rawLuma <= 1 ? fromLinearLuma(rawLuma) : 1 + 0.25 * Math.log2(rawLuma);
      const factor = Math.max(
        0,
        1 + shadows * (1 - smoothstep(0, 0.6, perceived)) + highlights * smoothstep(0.35, 1.1, perceived),
      );
      red *= factor;
      green *= factor;
      blue *= factor;
    }
    let luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    if (brightness !== 0 && luminance > 0 && luminance < 1) {
      const p = fromLinearLuma(luminance);
      const lifted = p + 4 * brightness * p * (1 - p);
      const requestedFactor = toLinearLuma(lifted) / luminance;
      const peak = Math.max(red, green, blue);
      const factor = requestedFactor > 1 && peak > 0
        ? Math.min(requestedFactor, Math.max(1, 0.992 / peak))
        : requestedFactor;
      red *= factor;
      green *= factor;
      blue *= factor;
      luminance *= factor;
    }
    let saturation = monochrome ? 0 : 1 + colour;
    if (!monochrome && vibrance !== 0) {
      const high = Math.max(red, green, blue);
      const chroma = high > 0 ? (high - Math.min(red, green, blue)) / high : 0;
      saturation += vibrance * (1 - Math.min(1, chroma));
    }
    let outRed = Math.max(0, luminance + (red - luminance) * saturation);
    let outGreen = Math.max(0, luminance + (green - luminance) * saturation);
    let outBlue = Math.max(0, luminance + (blue - luminance) * saturation);
    [outRed, outGreen, outBlue] = rollOffHighlights(outRed, outGreen, outBlue);

    if (curved || curveLut) {
      let eR = toUnit(outRed);
      let eG = toUnit(outGreen);
      let eB = toUnit(outBlue);
      if (curved) {
        eR = sCurve(eR, contrastAmount);
        eG = sCurve(eG, contrastAmount);
        eB = sCurve(eB, contrastAmount);
      }
      if (curveLut) {
        eR = lookupCurve(curveLut, eR);
        eG = lookupCurve(curveLut, eG);
        eB = lookupCurve(curveLut, eB);
      }
      pixels[index] = Math.round(eR * 255);
      pixels[index + 1] = Math.round(eG * 255);
      pixels[index + 2] = Math.round(eB * 255);
    } else {
      pixels[index] = toByte(outRed);
      pixels[index + 1] = toByte(outGreen);
      pixels[index + 2] = toByte(outBlue);
    }
  }
}

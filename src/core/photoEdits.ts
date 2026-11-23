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

export interface PhotoEdit {
  exposure: number;
  warmth: number;
  colour: number;
  /** Green to magenta, -2 to 2. Absent in older projects = neutral. */
  tint?: number;
  /** Perceptual midtone adjustment, distinct from exposure EV. Absent in older projects = neutral. */
  brightness?: number;
  contrast?: number;
  highlights?: number;
  shadows?: number;
  whites?: number;
  blacks?: number;
  vibrance?: number;
  texture?: number;
  clarity?: number;
  sharpen?: number;
  /** Colour noise reduction, 0 (off) to 2. Runs first, on the original pixels, before tone and sharpening. */
  denoise?: number;
  /** Export-time enlargement: 2 or 4 times the picture's own size, by the deterministic resampler (no model, nothing uploaded). Absent = off. */
  upscale?: 2 | 4;
  /** Local adjustments. They run after the whole-photo edit, in order. */
  masks?: Mask[];
}

export const DEFAULT_EDIT: PhotoEdit = { exposure: 0, warmth: 0, colour: 0 };

export const EDIT_CHOICES = [
  { key: 'exposure', label: 'Exposure', options: ['Darker', 'Neutral', 'Brighter'] },
  { key: 'warmth', label: 'Warmth', options: ['Cooler', 'Neutral', 'Warmer'] },
  { key: 'colour', label: 'Colour', options: ['Softer', 'Neutral', 'Richer'] },
] as const;

export function isNeutralTone(edit: PhotoEdit): boolean {
  return edit.exposure === 0 && edit.warmth === 0 && edit.colour === 0 && !edit.tint && TONE_CONTROLS.every(({ key }) => !edit[key]);
}

export const NOISE_CONTROL = { key: 'denoise', label: 'Noise reduction' } as const;

export function isNeutralEdit(edit: PhotoEdit): boolean {
  return !edit.denoise && !edit.upscale && isNeutralTone(edit) && DETAIL_CONTROLS.every(({ key }) => !edit[key]) && !hasActiveMasks(edit.masks);
}

/** Nothing to keep: neutral, and no masks at all (an empty mask is still kept so it can be adjusted). */
export function isEmptyEdit(edit: PhotoEdit): boolean {
  return isNeutralEdit(edit) && !edit.masks?.length;
}

/** Neutral apart from any local masks. Decides whether the whole-photo passes need to run. */
export function isNeutralGlobal(edit: PhotoEdit): boolean {
  return isNeutralTone(edit) && DETAIL_CONTROLS.every(({ key }) => !edit[key]);
}

const linear = Array.from({ length: 256 }, (_, index) => {
  const encoded = index / 255;
  return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
});

// Perceptual brightness uses finer tonal tables than the 8-bit image itself,
// avoiding unnecessary extra steps in smooth skies and backgrounds.
const MIDTONE_TABLE_SIZE = 16384;
const encodeLuma = Float32Array.from({ length: MIDTONE_TABLE_SIZE + 1 }, (_, i) => {
  const value = i / MIDTONE_TABLE_SIZE;
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
});
const decodeLuma = Float32Array.from({ length: MIDTONE_TABLE_SIZE + 1 }, (_, i) => {
  const value = i / MIDTONE_TABLE_SIZE;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
});
const fromLinearLuma = (value: number) => encodeLuma[Math.min(MIDTONE_TABLE_SIZE, Math.max(0, Math.round(value * MIDTONE_TABLE_SIZE)))];
const toLinearLuma = (value: number) => decodeLuma[Math.min(MIDTONE_TABLE_SIZE, Math.max(0, Math.round(value * MIDTONE_TABLE_SIZE)))];
const smoothstep = (low: number, high: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - low) / (high - low)));
  return t * t * (3 - 2 * t);
};

/** Shader-ready constants. The CPU path and the GPU shader both read these, so they cannot drift apart. */
export function editParams(edit: PhotoEdit) {
  const gain = 2 ** (edit.exposure * 0.4);
  const warmth = edit.warmth * 0.08;
  const tint = (edit.tint ?? 0) * 0.12;
  return {
    // On a neutral pixel, balance the magenta gains against green's linear luma weight.
    channelGain: [gain * (1 + warmth) * (1 + tint), gain * (1 - tint * (0.2848 / 0.7152)), gain * (1 - warmth) * (1 + tint)] as const,
    // A bounded monotonic midtone curve: pure black and white stay in place,
    // unlike exposure which multiplies scene-linear light in EV stops.
    brightness: (edit.brightness ?? 0) * 0.11,
    // Colour -2 is fully monochrome. Other slider positions keep their existing scale.
    colour: edit.colour === -2 ? -1 : edit.colour * 0.2,
    contrast: 1 + (edit.contrast ?? 0) * 0.35,
    highlights: (edit.highlights ?? 0) * 0.3,
    shadows: (edit.shadows ?? 0) * 0.3,
    blackPoint: -(edit.blacks ?? 0) * 0.02,
    whitePoint: 1 - (edit.whites ?? 0) * 0.08,
    vibrance: (edit.vibrance ?? 0) * 0.3,
  };
}
export type EditParams = ReturnType<typeof editParams>;

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

function boxBlur(source: Float32Array, width: number, height: number, radius: number): Float32Array {
  const temp = new Float32Array(source.length);
  const out = new Float32Array(source.length);
  const window = 2 * radius + 1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    for (let k = -radius; k <= radius; k += 1) sum += source[row + Math.min(width - 1, Math.max(0, k))];
    for (let x = 0; x < width; x += 1) {
      temp[row + x] = sum / window;
      sum += source[row + Math.min(width - 1, x + radius + 1)] - source[row + Math.max(0, x - radius)];
    }
  }
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let k = -radius; k <= radius; k += 1) sum += temp[Math.min(height - 1, Math.max(0, k)) * width + x];
    for (let y = 0; y < height; y += 1) {
      out[y * width + x] = sum / window;
      sum += temp[Math.min(height - 1, y + radius + 1) * width + x] - temp[Math.max(0, y - radius) * width + x];
    }
  }
  return out;
}

/** CPU reference for texture, clarity and sharpening. Adds the same luminance detail to every channel. */
/**
 * Texture and Clarity must not turn the noise in a smooth, out-of-focus background into grain (owner feedback, seen on
 * _DJL5983 at Texture 13, Clarity 45). When they add detail they work on a band measured from a lightly smoothed copy
 * (so single-pixel noise is not part of what they boost), and that band is soft-cored: values near the noise floor fade
 * out, feather-scale detail passes. Negative amounts still soften everything, noise included. The GPU renderer
 * (webglEdit.ts) uses the same formula.
 */
export const DETAIL_CORE = 0.008;
export const coreDetail = (band: number) => band * band * band / (band * band + DETAIL_CORE * DETAIL_CORE);

type DetailAmounts = ReturnType<typeof detailParams>;

/**
 * Add detail to rows `from` to `to` of `pixels` (`stride` samples per pixel, 0 to `max`), measured on `luma` (display
 * luma, 0 to 1, of rows `lumaFrom` onwards of the same picture). Shared by the 8-bit screen path and the 16-bit export.
 */
function addDetail(
  pixels: Uint8ClampedArray | Uint16Array, stride: number, max: number, width: number,
  luma: Float32Array, lumaFrom: number, lumaRows: number, from: number, to: number, d: DetailAmounts,
): void {
  const sharpBlur = d.sharpen || d.texture > 0 || d.clarity > 0 ? boxBlur(luma, width, lumaRows, d.sharpenRadius) : null;
  const textureBlur = d.texture ? boxBlur(luma, width, lumaRows, d.textureRadius) : null;
  const clarityBlur = d.clarity ? boxBlur(luma, width, lumaRows, d.clarityRadius) : null;
  for (let row = from; row < to; row += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (row - lumaFrom) * width + x;
      const l = luma[i];
      let add = 0;
      if (d.sharpen) add += d.sharpen * (l - sharpBlur![i]);
      if (textureBlur) add += d.texture * (d.texture > 0 ? coreDetail(sharpBlur![i] - textureBlur[i]) : l - textureBlur[i]);
      if (clarityBlur) add += d.clarity * 4 * l * (1 - l) * (d.clarity > 0 ? coreDetail(sharpBlur![i] - clarityBlur[i]) : l - clarityBlur[i]);
      const j = (row * width + x) * stride;
      for (let c = 0; c < 3; c += 1) pixels[j + c] = Math.round(Math.min(1, Math.max(0, pixels[j + c] / max + add)) * max);
    }
  }
}

function lumaRows(pixels: Uint8ClampedArray | Uint16Array, stride: number, max: number, width: number, from: number, to: number): Float32Array {
  const luma = new Float32Array(width * (to - from));
  for (let i = 0; i < luma.length; i += 1) {
    const j = (from * width + i) * stride;
    luma[i] = (0.2126 * pixels[j] + 0.7152 * pixels[j + 1] + 0.0722 * pixels[j + 2]) / max;
  }
  return luma;
}

export function applyDetail(pixels: Uint8ClampedArray, width: number, height: number, edit: PhotoEdit, imageEdge: number): void {
  if (!hasDetail(edit)) return;
  addDetail(pixels, 4, 255, width, lumaRows(pixels, 4, 255, width, 0, height), 0, height, 0, height, detailParams(edit, imageEdge));
}

/**
 * The same detail on a 16-bit RGB picture, in bands so a 45-megapixel export never holds whole-picture blur buffers.
 * Each band measures from the untouched picture with a margin as wide as the largest blur, so the bands join exactly.
 */
export function applyDetailRgb16(pixels: Uint16Array, width: number, height: number, edit: PhotoEdit, imageEdge: number, bandRows?: number): void {
  if (!hasDetail(edit)) return;
  const d = detailParams(edit, imageEdge);
  const margin = Math.max(d.sharpenRadius, d.textureRadius, d.clarityRadius);
  const band = Math.max(2 * margin, bandRows ?? Math.max(64, Math.floor(4_000_000 / width)));
  // Bands run top to bottom. A band's top margin lies in the band above, already changed by then, so before each band
  // is written the rows the next band will measure are kept as they were.
  let kept: Uint16Array | null = null;
  for (let from = 0; from < height; from += band) {
    const to = Math.min(height, from + band);
    const lumaFrom = Math.max(0, from - margin);
    const lumaTo = Math.min(height, to + margin);
    const luma = lumaRows(pixels, 3, 65535, width, lumaFrom, lumaTo);
    if (kept && from > lumaFrom) luma.set(lumaRows(kept, 3, 65535, width, 0, from - lumaFrom), 0);
    kept = to < height ? pixels.slice(Math.max(0, to - margin) * width * 3, to * width * 3) : null;
    addDetail(pixels, 3, 65535, width, luma, lumaFrom, lumaTo - lumaFrom, from, to, d);
  }
}

// Display encoding for any precision: a fine table read with linear interpolation, so 16-bit output has no steps.
const ENCODE_STEPS = 65536;
const encodeFine = Float32Array.from({ length: ENCODE_STEPS + 1 }, (_, i) => {
  const value = i / ENCODE_STEPS;
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
});
/** Linear light (0 to 1, clipped) to display-encoded sRGB (0 to 1). */
export function encodeLinear(value: number): number {
  if (!(value > 0)) return 0;
  if (value >= 1) return 1;
  const at = value * ENCODE_STEPS;
  const low = Math.floor(at);
  return encodeFine[low] + (encodeFine[low + 1] - encodeFine[low]) * (at - low);
}
/**
 * Mix two display-encoded 8-bit values in LINEAR light (the one mask-compositing convention, shared with the 16-bit
 * master's blendSrgb16). Mixing encoded values darkens feathered edges between unlike tones (a dark fringe).
 * Exact at alpha 0 and 1. Result is rounded to 8 bits.
 */
export function blendEncoded8(source: number, adjusted: number, alpha: number): number {
  if (alpha <= 0) return source;
  if (alpha >= 1) return adjusted;
  return Math.round(encodeLinear(linear[source] * (1 - alpha) + linear[adjusted] * alpha) * 255);
}
/** Display-encoded sRGB (0 to 1) to linear light. */
export function decodeEncoded(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/**
 * The whole-photo tone edit for one pixel: linear light in, display-encoded 0 to 1 out (written to `out`). The single
 * source of the maths for 8-bit previews and higher-precision exports alike; the GPU shader mirrors it.
 */
function tonePixel(red: number, green: number, blue: number, p: EditParams, out: Float32Array): void {
  const { channelGain, brightness, colour, contrast, highlights, shadows, blackPoint, whitePoint, vibrance } = p;
  red *= channelGain[0];
  green *= channelGain[1];
  blue *= channelGain[2];
  if (highlights !== 0 || shadows !== 0 || blackPoint !== 0 || whitePoint !== 1) {
    const range = whitePoint - blackPoint;
    red = (red - blackPoint) / range;
    green = (green - blackPoint) / range;
    blue = (blue - blackPoint) / range;
    const perceived = encodeLinear(0.2126 * red + 0.7152 * green + 0.0722 * blue);
    const factor = Math.max(0, 1 + shadows * (1 - smoothstep(0, 0.6, perceived)) + highlights * smoothstep(0.4, 1, perceived));
    red *= factor;
    green *= factor;
    blue *= factor;
  }
  let luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  if (brightness !== 0 && luminance > 0 && luminance < 1) {
    const e = fromLinearLuma(luminance);
    const lifted = e + 4 * brightness * e * (1 - e);
    // With brightness in [-0.22, 0.22] the curve remains monotonic.
    // Preserve existing chromaticity and do not invent highlights.
    const requestedFactor = toLinearLuma(lifted) / luminance;
    // Avoid blowing out one saturated channel just to increase overall luma.
    // Keep a little encoded highlight headroom where it still exists.
    const peak = Math.max(red, green, blue);
    const factor = requestedFactor > 1 && peak > 0 ? Math.min(requestedFactor, Math.max(1, 0.992 / peak)) : requestedFactor;
    red *= factor;
    green *= factor;
    blue *= factor;
    luminance *= factor;
  }
  const monochrome = colour === -1;
  let saturation = monochrome ? 0 : 1 + colour;
  if (!monochrome && vibrance !== 0) {
    const high = Math.max(red, green, blue);
    const chroma = high > 0 ? (high - Math.min(red, green, blue)) / high : 0;
    saturation += vibrance * (1 - Math.min(1, chroma));
  }
  out[0] = encodeLinear(luminance + (red - luminance) * saturation);
  out[1] = encodeLinear(luminance + (green - luminance) * saturation);
  out[2] = encodeLinear(luminance + (blue - luminance) * saturation);
  if (contrast !== 1) {
    for (let c = 0; c < 3; c += 1) out[c] = Math.min(1, Math.max(0, 0.5 + (out[c] - 0.5) * contrast));
  }
}

/** Apply adjustments to a browser-decoded sRGB image. Shared maths for preview, export and tests. */
export function applyPhotoEdit(pixels: Uint8ClampedArray, edit: PhotoEdit): void {
  if (isNeutralTone(edit)) return;
  const params = editParams(edit);
  const out = new Float32Array(3);
  for (let index = 0; index < pixels.length; index += 4) {
    tonePixel(linear[pixels[index]], linear[pixels[index + 1]], linear[pixels[index + 2]], params, out);
    pixels[index] = Math.round(out[0] * 255);
    pixels[index + 1] = Math.round(out[1] * 255);
    pixels[index + 2] = Math.round(out[2] * 255);
  }
}

/**
 * The same edit at full precision: RGBA floats in linear light (for example a 16-bit RAW develop) are replaced by
 * display-encoded values from 0 to 1. Alpha is left alone. Neutral settings still encode, so the output is always
 * display-encoded.
 */
export function applyPhotoEditLinear(pixels: Float32Array, edit: PhotoEdit): void {
  const params = editParams(edit);
  const out = new Float32Array(3);
  for (let index = 0; index < pixels.length; index += 4) {
    tonePixel(pixels[index], pixels[index + 1], pixels[index + 2], params, out);
    pixels[index] = out[0];
    pixels[index + 1] = out[1];
    pixels[index + 2] = out[2];
  }
}

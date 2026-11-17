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
  return edit.exposure === 0 && edit.warmth === 0 && edit.colour === 0 && TONE_CONTROLS.every(({ key }) => !edit[key]);
}

export function isNeutralEdit(edit: PhotoEdit): boolean {
  return isNeutralTone(edit) && DETAIL_CONTROLS.every(({ key }) => !edit[key]) && !hasActiveMasks(edit.masks);
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
const encoded = Uint8ClampedArray.from({ length: 4096 }, (_, index) => {
  const value = index / 4095;
  return 255 * (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055);
});
const encodedUnit = Float32Array.from(encoded, (value) => value / 255);
const toUnit = (value: number) => encodedUnit[Math.min(4095, Math.max(0, Math.round(value * 4095)))];

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
const toByte = (value: number) => encoded[Math.min(4095, Math.max(0, Math.round(value * 4095)))];

/** Shader-ready constants. The CPU path and the GPU shader both read these, so they cannot drift apart. */
export function editParams(edit: PhotoEdit) {
  return {
    gain: 2 ** (edit.exposure * 0.4),
    // A bounded monotonic midtone curve: pure black and white stay in place,
    // unlike exposure which multiplies scene-linear light in EV stops.
    brightness: (edit.brightness ?? 0) * 0.11,
    warmth: edit.warmth * 0.08,
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
export function applyDetail(pixels: Uint8ClampedArray, width: number, height: number, edit: PhotoEdit, imageEdge: number): void {
  if (!hasDetail(edit)) return;
  const d = detailParams(edit, imageEdge);
  const luma = new Float32Array(width * height);
  for (let i = 0; i < luma.length; i += 1) {
    luma[i] = (0.2126 * pixels[i * 4] + 0.7152 * pixels[i * 4 + 1] + 0.0722 * pixels[i * 4 + 2]) / 255;
  }
  const sharpBlur = d.sharpen ? boxBlur(luma, width, height, d.sharpenRadius) : null;
  const textureBlur = d.texture ? boxBlur(luma, width, height, d.textureRadius) : null;
  const clarityBlur = d.clarity ? boxBlur(luma, width, height, d.clarityRadius) : null;
  for (let i = 0; i < luma.length; i += 1) {
    const l = luma[i];
    let add = 0;
    if (sharpBlur) add += d.sharpen * (l - sharpBlur[i]);
    if (textureBlur) add += d.texture * (l - textureBlur[i]);
    if (clarityBlur) add += d.clarity * 4 * l * (1 - l) * (l - clarityBlur[i]);
    const j = i * 4;
    pixels[j] = Math.round(Math.min(1, Math.max(0, pixels[j] / 255 + add)) * 255);
    pixels[j + 1] = Math.round(Math.min(1, Math.max(0, pixels[j + 1] / 255 + add)) * 255);
    pixels[j + 2] = Math.round(Math.min(1, Math.max(0, pixels[j + 2] / 255 + add)) * 255);
  }
}

/** Apply adjustments to a browser-decoded sRGB image. Shared maths for preview, export and tests. */
export function applyPhotoEdit(pixels: Uint8ClampedArray, edit: PhotoEdit): void {
  if (isNeutralTone(edit)) return;
  const { gain, brightness, warmth, colour, contrast, highlights, shadows, blackPoint, whitePoint, vibrance } = editParams(edit);
  const tonal = highlights !== 0 || shadows !== 0 || blackPoint !== 0 || whitePoint !== 1;
  const curved = contrast !== 1;

  for (let index = 0; index < pixels.length; index += 4) {
    let red = linear[pixels[index]] * gain * (1 + warmth);
    let green = linear[pixels[index + 1]] * gain;
    let blue = linear[pixels[index + 2]] * gain * (1 - warmth);
    if (tonal) {
      const range = whitePoint - blackPoint;
      red = (red - blackPoint) / range;
      green = (green - blackPoint) / range;
      blue = (blue - blackPoint) / range;
      const perceived = toUnit(0.2126 * red + 0.7152 * green + 0.0722 * blue);
      const factor = Math.max(0, 1 + shadows * (1 - smoothstep(0, 0.6, perceived)) +
        highlights * smoothstep(0.4, 1, perceived));
      red *= factor;
      green *= factor;
      blue *= factor;
    }
    let luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    if (brightness !== 0 && luminance > 0 && luminance < 1) {
      const p = fromLinearLuma(luminance);
      const lifted = p + 4 * brightness * p * (1 - p);
      // With brightness in [-0.22, 0.22] the curve remains monotonic.
      // Preserve existing chromaticity and do not invent highlights.
      const factor = toLinearLuma(lifted) / luminance;
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
    let outRed = luminance + (red - luminance) * saturation;
    let outGreen = luminance + (green - luminance) * saturation;
    let outBlue = luminance + (blue - luminance) * saturation;
    if (curved) {
      outRed = 0.5 + (toUnit(outRed) - 0.5) * contrast;
      outGreen = 0.5 + (toUnit(outGreen) - 0.5) * contrast;
      outBlue = 0.5 + (toUnit(outBlue) - 0.5) * contrast;
      pixels[index] = Math.round(outRed * 255);
      pixels[index + 1] = Math.round(outGreen * 255);
      pixels[index + 2] = Math.round(outBlue * 255);
    } else {
      pixels[index] = toByte(outRed);
      pixels[index + 1] = toByte(outGreen);
      pixels[index + 2] = toByte(outBlue);
    }
  }
}

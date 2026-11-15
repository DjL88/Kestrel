/** Optional tonal controls. Each runs from -2 to 2 and an absent value means 0. */
export const TONE_CONTROLS = [
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
  contrast?: number;
  highlights?: number;
  shadows?: number;
  whites?: number;
  blacks?: number;
  vibrance?: number;
  texture?: number;
  clarity?: number;
  sharpen?: number;
}

export const DEFAULT_EDIT: PhotoEdit = { exposure: 0, warmth: 0, colour: 0 };

export const EDIT_CHOICES = [
  { key: 'exposure', label: 'Light', options: ['Darker', 'Neutral', 'Brighter'] },
  { key: 'warmth', label: 'Warmth', options: ['Cooler', 'Neutral', 'Warmer'] },
  { key: 'colour', label: 'Colour', options: ['Softer', 'Neutral', 'Richer'] },
] as const;

function isNeutralTone(edit: PhotoEdit): boolean {
  return edit.exposure === 0 && edit.warmth === 0 && edit.colour === 0 && TONE_CONTROLS.every(({ key }) => !edit[key]);
}

export function isNeutralEdit(edit: PhotoEdit): boolean {
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
const smoothstep = (low: number, high: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - low) / (high - low)));
  return t * t * (3 - 2 * t);
};
const toByte = (value: number) => encoded[Math.min(4095, Math.max(0, Math.round(value * 4095)))];

/** Shader-ready constants. The CPU path and the GPU shader both read these, so they cannot drift apart. */
export function editParams(edit: PhotoEdit) {
  return {
    gain: 2 ** (edit.exposure * 0.4),
    warmth: edit.warmth * 0.08,
    colour: edit.colour * 0.2,
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
  const { gain, warmth, colour, contrast, highlights, shadows, blackPoint, whitePoint, vibrance } = editParams(edit);
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
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    let saturation = 1 + colour;
    if (vibrance !== 0) {
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

function applyCanvasDetail(canvas: HTMLCanvasElement, edit: PhotoEdit, imageEdge: number): void {
  if (!hasDetail(edit)) return;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  applyDetail(pixels.data, canvas.width, canvas.height, edit, imageEdge);
  context.putImageData(pixels, 0, 0);
}

function* editCanvasStrips(canvas: HTMLCanvasElement, edit: PhotoEdit): Generator<void> {
  if (isNeutralTone(edit)) return;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  const rows = Math.max(1, Math.floor(262144 / canvas.width));
  for (let y = 0; y < canvas.height; y += rows) {
    const pixels = context.getImageData(0, y, canvas.width, Math.min(rows, canvas.height - y));
    applyPhotoEdit(pixels.data, edit);
    context.putImageData(pixels, 0, y);
    yield;
  }
}

type GpuRenderer = (canvas: HTMLCanvasElement, edit: PhotoEdit, imageEdge: number) => boolean;
let gpuRenderer: GpuRenderer | null = null;
/** Register a GPU renderer. It returns false when it cannot handle the canvas, and the CPU path runs instead. */
export function setGpuRenderer(renderer: GpuRenderer | null): void {
  gpuRenderer = renderer;
}

/** imageEdge is the whole image's long edge in this canvas's pixels. It defaults to the canvas, and differs for zoomed regions. */
export function applyCanvasPhotoEdit(canvas: HTMLCanvasElement, edit: PhotoEdit, imageEdge = Math.max(canvas.width, canvas.height)): void {
  if (isNeutralEdit(edit)) return;
  if (gpuRenderer?.(canvas, edit, imageEdge)) return;
  for (const _ of editCanvasStrips(canvas, edit)) {
    // The fit preview has a bounded raster, so render it in one pass.
  }
  applyCanvasDetail(canvas, edit, imageEdge);
}

export async function applyCanvasExportEdit(canvas: HTMLCanvasElement, edit: PhotoEdit, signal?: AbortSignal): Promise<void> {
  if (!isNeutralEdit(edit) && gpuRenderer?.(canvas, edit, Math.max(canvas.width, canvas.height))) return;
  let lastYield = performance.now();
  for (const _ of editCanvasStrips(canvas, edit)) {
    signal?.throwIfAborted();
    if (performance.now() - lastYield < 16) continue;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    lastYield = performance.now();
  }
  applyCanvasDetail(canvas, edit, Math.max(canvas.width, canvas.height));
}

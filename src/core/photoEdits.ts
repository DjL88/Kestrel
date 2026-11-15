/** Optional tonal controls. Each runs from -2 to 2 and an absent value means 0. */
export const TONE_CONTROLS = [
  { key: 'contrast', label: 'Contrast' },
  { key: 'highlights', label: 'Highlights' },
  { key: 'shadows', label: 'Shadows' },
  { key: 'whites', label: 'Whites' },
  { key: 'blacks', label: 'Blacks' },
  { key: 'vibrance', label: 'Vibrance' },
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
}

export const DEFAULT_EDIT: PhotoEdit = { exposure: 0, warmth: 0, colour: 0 };

export const EDIT_CHOICES = [
  { key: 'exposure', label: 'Light', options: ['Darker', 'Neutral', 'Brighter'] },
  { key: 'warmth', label: 'Warmth', options: ['Cooler', 'Neutral', 'Warmer'] },
  { key: 'colour', label: 'Colour', options: ['Softer', 'Neutral', 'Richer'] },
] as const;

export function isNeutralEdit(edit: PhotoEdit): boolean {
  return edit.exposure === 0 && edit.warmth === 0 && edit.colour === 0 &&
    TONE_CONTROLS.every(({ key }) => !edit[key]);
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

/** Apply adjustments to a browser-decoded sRGB image. Shared maths for preview, export and tests. */
export function applyPhotoEdit(pixels: Uint8ClampedArray, edit: PhotoEdit): void {
  if (isNeutralEdit(edit)) return;
  const gain = 2 ** (edit.exposure * 0.4);
  const warmth = edit.warmth * 0.08;
  const colour = edit.colour * 0.2;
  const contrast = 1 + (edit.contrast ?? 0) * 0.35;
  const highlights = (edit.highlights ?? 0) * 0.3;
  const shadows = (edit.shadows ?? 0) * 0.3;
  const blackPoint = -(edit.blacks ?? 0) * 0.02;
  const whitePoint = 1 - (edit.whites ?? 0) * 0.08;
  const vibrance = (edit.vibrance ?? 0) * 0.3;
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

function* editCanvasStrips(canvas: HTMLCanvasElement, edit: PhotoEdit): Generator<void> {
  if (isNeutralEdit(edit)) return;
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

export function applyCanvasPhotoEdit(canvas: HTMLCanvasElement, edit: PhotoEdit): void {
  for (const _ of editCanvasStrips(canvas, edit)) {
    // The fit preview has a bounded raster, so render it in one pass.
  }
}

export async function applyCanvasExportEdit(canvas: HTMLCanvasElement, edit: PhotoEdit, signal?: AbortSignal): Promise<void> {
  let lastYield = performance.now();
  for (const _ of editCanvasStrips(canvas, edit)) {
    signal?.throwIfAborted();
    if (performance.now() - lastYield < 16) continue;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    lastYield = performance.now();
  }
}

export interface PhotoEdit {
  exposure: number;
  warmth: number;
  colour: number;
}

export const DEFAULT_EDIT: PhotoEdit = { exposure: 0, warmth: 0, colour: 0 };

export const EDIT_CHOICES = [
  { key: 'exposure', label: 'Light', options: ['Darker', 'Neutral', 'Brighter'] },
  { key: 'warmth', label: 'Warmth', options: ['Cooler', 'Neutral', 'Warmer'] },
  { key: 'colour', label: 'Colour', options: ['Softer', 'Neutral', 'Richer'] },
] as const;

export function isNeutralEdit(edit: PhotoEdit): boolean {
  return edit.exposure === 0 && edit.warmth === 0 && edit.colour === 0;
}

const linear = Array.from({ length: 256 }, (_, index) => {
  const encoded = index / 255;
  return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
});
const encoded = Uint8ClampedArray.from({ length: 4096 }, (_, index) => {
  const value = index / 4095;
  return 255 * (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055);
});
const toByte = (value: number) => encoded[Math.min(4095, Math.max(0, Math.round(value * 4095)))];

/** Apply modest adjustments to a browser-decoded sRGB image. */
export function applyPhotoEdit(pixels: Uint8ClampedArray, edit: PhotoEdit): void {
  if (isNeutralEdit(edit)) return;
  const gain = 2 ** (edit.exposure * 0.4);
  const warmth = edit.warmth * 0.08;
  const saturation = 1 + edit.colour * 0.2;

  for (let index = 0; index < pixels.length; index += 4) {
    const red = linear[pixels[index]] * gain * (1 + warmth);
    const green = linear[pixels[index + 1]] * gain;
    const blue = linear[pixels[index + 2]] * gain * (1 - warmth);
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    pixels[index] = toByte(luminance + (red - luminance) * saturation);
    pixels[index + 1] = toByte(luminance + (green - luminance) * saturation);
    pixels[index + 2] = toByte(luminance + (blue - luminance) * saturation);
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

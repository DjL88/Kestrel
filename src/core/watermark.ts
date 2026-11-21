export type WatermarkPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'centre' | 'tiled';

export interface WatermarkOptions {
  on: boolean;
  kind: 'text' | 'image';
  text: string;
  /** Resolved in memory for the preview/export renderer; never persist in presets. */
  imageData?: string;
  /** Private local asset fingerprint, not a network URL or portable image. */
  imageAssetId?: string;
  position: WatermarkPosition;
  /** Share of the picture's short side, 0.04 to 0.5. For an image this is the width as a share of the long side. */
  size: number;
  opacity: number;
  /** Automatic chooses light or dark text from pixels under each watermark. */
  tone: 'light' | 'dark' | 'auto';
  /** A bundled/safe font family id; never inject arbitrary font strings into Canvas. */
  font?: 'inter' | 'jakarta' | 'atkinson' | 'serif' | 'classic' | 'mono' | 'rounded' | 'condensed' | 'script';
}

export const NO_WATERMARK: WatermarkOptions = { on: false, kind: 'text', text: '', position: 'bottom-right', size: 0.06, opacity: 0.7, tone: 'auto', font: 'inter' };

export const WATERMARK_POSITIONS: { id: WatermarkPosition; label: string }[] = [
  { id: 'top-left', label: 'Top left' }, { id: 'top-right', label: 'Top right' },
  { id: 'bottom-left', label: 'Bottom left' }, { id: 'bottom-right', label: 'Bottom right' },
  { id: 'centre', label: 'Centre' }, { id: 'tiled', label: 'Repeated across the photo' },
];

/** Whether there is anything to draw. */
export function hasWatermark(options?: WatermarkOptions): boolean {
  if (!options?.on) return false;
  return options.kind === 'text' ? options.text.trim().length > 0 : Boolean(options.imageData);
}

/** Top-left corners for each copy of a mark, so the mark sits `margin` pixels from the edge. Tiled copies are staggered. */
export function watermarkSpots(width: number, height: number, markWidth: number, markHeight: number, position: WatermarkPosition): { x: number; y: number }[] {
  const margin = Math.round(Math.min(width, height) * 0.03);
  const left = margin, right = width - markWidth - margin, top = margin, bottom = height - markHeight - margin;
  switch (position) {
    case 'top-left': return [{ x: left, y: top }];
    case 'top-right': return [{ x: right, y: top }];
    case 'bottom-left': return [{ x: left, y: bottom }];
    case 'bottom-right': return [{ x: right, y: bottom }];
    case 'centre': return [{ x: (width - markWidth) / 2, y: (height - markHeight) / 2 }];
    case 'tiled': {
      const stepX = markWidth * 2.2, stepY = markHeight * 3.2, spots: { x: number; y: number }[] = [];
      for (let row = 0, y = stepY / 2 - markHeight / 2; y < height; row += 1, y += stepY) {
        for (let x = (row % 2) * (stepX / 2) - markWidth / 2; x < width; x += stepX) spots.push({ x, y });
      }
      return spots;
    }
  }
}

/** Only packaged font families can be selected; callers must not inject arbitrary CSS. */
export const WATERMARK_FONTS = [
  { id: 'inter', label: 'Inter', css: 'Inter, system-ui, sans-serif' },
  { id: 'jakarta', label: 'Plus Jakarta Sans', css: '"Plus Jakarta Sans", system-ui, sans-serif' },
  { id: 'atkinson', label: 'Atkinson Hyperlegible', css: '"Atkinson Hyperlegible", system-ui, sans-serif' },
  // Device fonts: nothing is downloaded or bundled, so the look follows the platform's own serif, mono and so on.
  { id: 'serif', label: 'Serif (device)', css: 'Georgia, "Times New Roman", serif' },
  { id: 'classic', label: 'Classic book (device)', css: '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif' },
  { id: 'mono', label: 'Typewriter (device)', css: 'ui-monospace, Menlo, Consolas, "Courier New", monospace' },
  { id: 'rounded', label: 'Rounded (device)', css: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", system-ui, sans-serif' },
  { id: 'condensed', label: 'Condensed (device)', css: '"Arial Narrow", "Roboto Condensed", "Helvetica Neue", sans-serif' },
  { id: 'script', label: 'Handwriting (device)', css: '"Segoe Script", "Snell Roundhand", "Bradley Hand", cursive' },
] as const;

export const watermarkFont = (font: WatermarkOptions['font']): string =>
  WATERMARK_FONTS.find((entry) => entry.id === font)?.css ?? WATERMARK_FONTS[0].css;

/** Calculate perceived luminance from sRGB without treating gamma values as linear light. */
function linearChannel(value: number): number {
  const x = Math.min(255, Math.max(0, value)) / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

/**
 * Pick the text tone with the better average contrast over the *actual pixels* behind its footprint.
 * Sampling is bounded, independent of source dimensions; preview/export invoke exactly this function.
 * Returns light for unreadable/transparent/empty patches, and never changes image-watermark artwork.
 */
export function watermarkToneForPixels(
  data: Uint8ClampedArray, width: number, height: number, stride = 4,
): 'light' | 'dark' {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 ||
      !Number.isSafeInteger(stride) || stride < 4 || data.length < width * height * stride) return 'light';
  const step = Math.max(1, Math.ceil(Math.sqrt((width * height) / 1024)));
  let lightScore = 0;
  let darkScore = 0;
  let count = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const index = (y * width + x) * stride;
      const alpha = data[index + 3] / 255;
      if (alpha < 0.1) continue;
      const luminance = 0.2126 * linearChannel(data[index]) +
        0.7152 * linearChannel(data[index + 1]) + 0.0722 * linearChannel(data[index + 2]);
      // Contrast ratio against white (L=1) and deep charcoal (L≈0.006).
      lightScore += (1.05 / (luminance + 0.05)) * alpha;
      darkScore += ((luminance + 0.05) / (0.006 + 0.05)) * alpha;
      count += alpha;
    }
  }
  return count > 0 && darkScore > lightScore ? 'dark' : 'light';
}

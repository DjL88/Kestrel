export type WatermarkPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'centre' | 'tiled';

export interface WatermarkOptions {
  on: boolean;
  kind: 'text' | 'image';
  text: string;
  /** A PNG or other picture, kept as a data address so it travels with the settings. */
  imageData?: string;
  position: WatermarkPosition;
  /** Share of the picture's short side, 0.04 to 0.5. For an image this is the width as a share of the long side. */
  size: number;
  opacity: number;
  tone: 'light' | 'dark';
}

export const NO_WATERMARK: WatermarkOptions = { on: false, kind: 'text', text: '', position: 'bottom-right', size: 0.06, opacity: 0.7, tone: 'light' };

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

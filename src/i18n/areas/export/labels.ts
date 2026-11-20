import { shapeLabel, type ExportFormat } from '../../../core/exportFormats';
import type { WatermarkPosition } from '../../../core/watermark';
import { exportText as t } from './index';

type Kind = 'post' | 'square' | 'storyOrReelCover' | 'story' | 'wide' | 'photoPost' | 'pin' | 'keepShape';

/** What each built-in format is, by its id in `src/core/exportFormats.ts`, so its name can be written in any language. */
const FORMAT_KINDS: Record<string, Kind> = {
  'ig-45': 'post', 'ig-34': 'post', 'ig-11': 'square', 'ig-story': 'storyOrReelCover',
  'fb-45': 'post', 'fb-11': 'square', 'fb-wide': 'wide', 'fb-story': 'story', 'fb-keep': 'keepShape',
  'tt-story': 'photoPost', 'tt-45': 'photoPost', 'th-34': 'post', 'th-11': 'square',
  'x-wide': 'wide', 'x-11': 'square', 'x-keep': 'keepShape', 'bsky-keep': 'keepShape', 'bsky-11': 'square', 'pin-23': 'pin',
};

/** A short name for a shape, such as "4:5", or "Original shape" when it has none. */
export function shapeName(width: number, height: number): string {
  return width > 0 && height > 0 ? shapeLabel(width, height) : t.formats.originalShape;
}

/** "1080 × 1350 px", or "Original size". */
export function sizeName(format: Pick<ExportFormat, 'width' | 'height'>): string {
  return format.width && format.height ? t.formats.size(format.width, format.height) : t.formats.originalSize;
}

/** A format's name in the session language, following its current shape (a turned 4:5 post reads 5:4). */
export function formatLabel(format: ExportFormat): string {
  if (format.id === 'master') return t.formats.master;
  if (format.id === 'custom') return t.formats.custom(format.width, format.height);
  const kind = FORMAT_KINDS[format.id];
  if (!kind) return format.label;
  if (kind === 'keepShape') return t.formats.keepShape(Math.max(format.width, format.height));
  return t.formats[kind](shapeName(format.width, format.height));
}

export function watermarkPositionLabel(position: WatermarkPosition): string {
  const { positions } = t.watermark;
  return {
    'top-left': positions.topLeft, 'top-right': positions.topRight, 'bottom-left': positions.bottomLeft,
    'bottom-right': positions.bottomRight, centre: positions.centre, tiled: positions.tiled,
  }[position];
}

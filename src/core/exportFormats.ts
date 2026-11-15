import type { ExportFraming } from './exportFraming';
import type { ExportProfile } from './exportProfiles';
import type { SocialIconId } from './socialIcons';

/**
 * How a photo is fitted into a format that has a fixed shape.
 * fill: crop to the shape (the crop position can be moved per photo).
 * bars: keep the whole photo and put borders around it.
 * keep: keep the photo's own shape, only scaling it down to fit inside the size.
 */
export type Fit = 'fill' | 'bars' | 'keep';

export type BarStyle = 'white' | 'black' | 'blur';

export interface ExportFormat {
  id: string;
  /** Which brand mark to show. Absent for file formats and custom sizes. */
  platform?: SocialIconId;
  label: string;
  width: number;
  height: number;
  fit: Fit;
  quality: number;
  format: 'jpeg' | 'png';
  prefix: string;
  maxBytes?: number;
}

export const PLATFORMS: readonly { id: SocialIconId; label: string }[] = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'threads', label: 'Threads' },
  { id: 'x', label: 'X' },
  { id: 'bluesky', label: 'Bluesky' },
  { id: 'pinterest', label: 'Pinterest' },
];

const social = (id: string, platform: SocialIconId, label: string, width: number, height: number, fit: Fit, extra: Partial<ExportFormat> = {}): ExportFormat =>
  ({ id, platform, label, width, height, fit, quality: 0.94, format: 'jpeg', prefix: `${id.split('-')[0]}_`, ...extra });

/**
 * Common sizes for each destination. Platforms change what they accept and how they crop, so treat these as good
 * starting points, and check a platform's current guidance before relying on an exact size.
 */
export const EXPORT_FORMATS: readonly ExportFormat[] = [
  { id: 'master', label: 'Full size · PNG', width: 0, height: 0, fit: 'keep', quality: 1, format: 'png', prefix: '' },
  social('ig-45', 'instagram', 'Post · 4:5', 1080, 1350, 'fill'),
  social('ig-34', 'instagram', 'Post · 3:4', 1080, 1440, 'fill'),
  social('ig-11', 'instagram', 'Square · 1:1', 1080, 1080, 'fill'),
  social('ig-story', 'instagram', 'Story or Reel cover · 9:16', 1080, 1920, 'fill'),
  social('fb-45', 'facebook', 'Post · 4:5', 1080, 1350, 'fill'),
  social('fb-11', 'facebook', 'Square · 1:1', 1080, 1080, 'fill'),
  social('fb-wide', 'facebook', 'Wide · 1.91:1', 1200, 630, 'fill'),
  social('fb-story', 'facebook', 'Story · 9:16', 1080, 1920, 'fill'),
  social('fb-keep', 'facebook', 'Keep shape · up to 2048 px', 2048, 2048, 'keep'),
  social('tt-story', 'tiktok', 'Photo post · 9:16', 1080, 1920, 'fill'),
  social('tt-45', 'tiktok', 'Photo post · 4:5', 1080, 1350, 'fill'),
  social('th-34', 'threads', 'Post · 3:4', 1440, 1920, 'fill'),
  social('th-11', 'threads', 'Square · 1:1', 1080, 1080, 'fill'),
  social('x-wide', 'x', 'Wide · 16:9', 1600, 900, 'fill', { maxBytes: 5_000_000 }),
  social('x-11', 'x', 'Square · 1:1', 1080, 1080, 'fill', { maxBytes: 5_000_000 }),
  social('x-keep', 'x', 'Keep shape · up to 2048 px', 2048, 2048, 'keep', { maxBytes: 5_000_000 }),
  social('bsky-keep', 'bluesky', 'Keep shape · up to 2000 px', 2000, 2000, 'keep', { prefix: 'bsky_' }),
  social('bsky-11', 'bluesky', 'Square · 1:1', 1080, 1080, 'fill', { prefix: 'bsky_' }),
  social('pin-23', 'pinterest', 'Pin · 2:3', 1000, 1500, 'fill', { prefix: 'pin_' }),
];

/** Saved choices from before there were formats, mapped to the nearest format with the same size. */
export const LEGACY_FORMAT_IDS: Record<string, string> = {
  master: 'master', ig: 'ig-34', fb: 'fb-keep', tok: 'tt-story', x: 'x-keep', th: 'th-34',
};

export function formatById(id: string): ExportFormat | undefined {
  return EXPORT_FORMATS.find((format) => format.id === id);
}

/** The export engine plans and renders from a profile and a framing mode. */
export function toProfile(format: ExportFormat): ExportProfile {
  return { id: format.id, label: format.label, prefix: format.prefix, width: format.width, height: format.height,
    quality: format.quality, format: format.format, maxBytes: format.maxBytes, suffix: fileSuffix(format) };
}

/** What tells one format of a photo from another in a file name: its shape, or its size for custom and keep-shape formats. */
export function fileSuffix(format: ExportFormat): string | undefined {
  if (format.id === 'master' || !(format.width > 0 && format.height > 0)) return undefined;
  if (format.id === 'custom') return `${format.width}x${format.height}`;
  if (format.fit === 'keep') return `max${Math.max(format.width, format.height)}`;
  return shapeLabel(format.width, format.height).replace(':', 'x');
}

export function framingFor(fit: Fit): ExportFraming {
  return fit === 'fill' ? 'focus' : fit === 'bars' ? 'border' : 'fit';
}

const COMMON_SHAPES: [number, string][] = [
  [1, '1:1'], [4 / 5, '4:5'], [3 / 4, '3:4'], [2 / 3, '2:3'], [9 / 16, '9:16'], [16 / 9, '16:9'], [1.91, '1.91:1'], [3 / 2, '3:2'], [5 / 4, '5:4'], [4 / 3, '4:3'],
];

/** A short name for a shape, such as "4:5". Uncommon shapes get a decimal. */
export function shapeLabel(width: number, height: number): string {
  if (!(width > 0 && height > 0)) return 'Original shape';
  const ratio = width / height;
  const match = COMMON_SHAPES.find(([shape]) => Math.abs(shape - ratio) / shape < 0.01);
  return match ? match[1] : `${ratio.toFixed(2)}:1`;
}

export const sizeLabel = (format: Pick<ExportFormat, 'width' | 'height'>) => (format.width && format.height ? `${format.width} × ${format.height} px` : 'Original size');

export interface CustomSize {
  width: number;
  height: number;
  fit: Fit;
  format: 'jpeg' | 'png';
  /** JPEG quality as a whole number from 50 to 100. */
  quality: number;
  prefix: string;
}

export const MAX_CUSTOM_EDGE = 12000;
export const MAX_CUSTOM_PIXELS = 100_000_000;

/** Check a custom size, and say what is wrong in plain words. */
export function customFormat(input: CustomSize): { format: ExportFormat } | { error: string } {
  const { width, height } = input;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return { error: 'Enter whole numbers for the width and height.' };
  if (width > MAX_CUSTOM_EDGE || height > MAX_CUSTOM_EDGE) return { error: `Each side can be at most ${MAX_CUSTOM_EDGE.toLocaleString()} px.` };
  if (width * height > MAX_CUSTOM_PIXELS) return { error: 'That is more than 100 megapixels, which most devices cannot make. Choose a smaller size.' };
  if (!Number.isFinite(input.quality) || input.quality < 50 || input.quality > 100) return { error: 'JPEG quality must be between 50 and 100.' };
  return { format: {
    id: 'custom', label: `Custom · ${width} × ${height}`, width, height, fit: input.fit, format: input.format,
    quality: input.format === 'png' ? 1 : input.quality / 100, prefix: input.prefix.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 24),
  } };
}

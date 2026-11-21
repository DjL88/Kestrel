import { exportOverlayTitle, NO_OVERLAY } from './exportOverlay';
import type { PhotoFrame } from './types';
import type { TiffExportMetadata } from './tiffExportMetadata';

export interface ExportMetadataOptions {
  /** No metadata is copied unless the photographer explicitly enables it. */
  enabled: boolean;
  /** null: confirmed per-photo subject. Empty string: no title. */
  title: string | null;
  caption: string;
  creator: string;
  copyright: string;
  /** Comma-separated override; blank uses confirmed per-photo tags. */
  keywords: string;
  includeKeywords: boolean;
}
export const NO_EXPORT_METADATA: ExportMetadataOptions = {
  enabled: false, title: null, caption: '', creator: '', copyright: '', keywords: '', includeKeywords: false,
};

function bounded(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.slice(0, maximum) : '';
}
export function parseExportMetadataOptions(value: unknown): ExportMetadataOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...NO_EXPORT_METADATA };
  const item = value as Record<string, unknown>;
  return {
    enabled: item.enabled === true,
    title: item.title === null ? null : bounded(item.title, 200),
    caption: bounded(item.caption, 4096),
    creator: bounded(item.creator, 200),
    copyright: bounded(item.copyright, 300),
    keywords: bounded(item.keywords, 2048),
    includeKeywords: item.includeKeywords === true,
  };
}

/** Build a fresh payload for each photo, never from the original file's
 * EXIF. Automatically suggested/unconfirmed tags stay out of exported data.
 * The person can override each field, leave it empty, or turn this off.
 */
export function metadataForExport(
  frame: Pick<PhotoFrame, 'subjectNames' | 'autoTags' | 'tags'>,
  options: ExportMetadataOptions,
): TiffExportMetadata | null {
  if (!options.enabled) return null;
  const suggestions = new Set((frame.autoTags ?? []).map(tag => tag.trim().toLocaleLowerCase('en-GB')));
  const confirmed = [...(frame.subjectNames ?? []), ...(frame.tags ?? [])]
    .map(tag => tag.trim()).filter(tag => tag && !suggestions.has(tag.toLocaleLowerCase('en-GB')));
  const title = options.title === null ? exportOverlayTitle(frame, NO_OVERLAY) : options.title;
  const rawKeywords = options.keywords.trim()
    ? options.keywords.split(/[,;\n]/g).map(tag => tag.trim()).filter(Boolean)
    : confirmed;
  const keywords = options.includeKeywords
    ? [...new Set(rawKeywords.map(tag => tag.slice(0, 200)))].slice(0, 64)
    : [];
  return {
    title, caption: options.caption, creator: options.creator,
    copyright: options.copyright, keywords,
  };
}

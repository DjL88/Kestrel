import { EXPORT_FORMATS, type ExportFormat } from './exportFormats';
import type { SocialIconId } from './socialIcons';

/**
 * One photograph, one output. A common 1080×1350 JPEG need not be rendered
 * separately simply because three destinations accept it.
 *
 * Group only identical width, height, orientation, fit, encoding, compression
 * and file-size restrictions. A 3:4 frame at 1440px is NOT a duplicate of
 * a 1080px 3:4 frame. Destination-specific crop/zoom remains a separate
 * render unless the caller proves those settings are also identical.
 */
export interface SocialSizeGroup {
  canonical: ExportFormat;
  ids: readonly string[];
  platforms: readonly SocialIconId[];
}

export function socialRenderKey(format: ExportFormat): string {
  return [
    format.width, format.height, format.fit, format.format,
    Math.round(format.quality * 10000), format.maxBytes ?? '',
    format.allowUpscale === true ? 1 : 0,
  ].join('|');
}

export function commonSocialSizes(formats: readonly ExportFormat[] = EXPORT_FORMATS): SocialSizeGroup[] {
  const groups = new Map<string, { canonical: ExportFormat; ids: string[]; platforms: SocialIconId[] }>();
  for (const format of formats) {
    if (!format.platform) continue;
    const key = socialRenderKey(format);
    const found = groups.get(key);
    if (found) {
      found.ids.push(format.id);
      if (!found.platforms.includes(format.platform)) found.platforms.push(format.platform);
    } else {
      groups.set(key, { canonical: format, ids: [format.id], platforms: [format.platform] });
    }
  }
  return [...groups.values()];
}

/** Do not deduplicate shapes if either photo has a different crop/focus/zoom. */
export function uniqueRenderedSocialFormats(
  formats: readonly ExportFormat[],
  destinationFingerprint: (format: ExportFormat) => string = () => '',
): ExportFormat[] {
  const seen = new Set<string>();
  return formats.filter(format => {
    if (!format.platform) return true;
    const key = socialRenderKey(format) + '|' + destinationFingerprint(format);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

import { exportFilename } from './exportProfiles';
import { toProfile, type ExportFormat } from './exportFormats';
import { isRawPreviewFile } from './rawFormats';
import { stemFor, uniqueExportFilename, type NameTemplate } from './exportNaming';
import type { PhotoFrame } from './types';
import type { ExportBatchItem } from './exportBatchQueue';

/**
 * One immutable export destination plan, created before the dialog closes.
 * The destination/filename is chosen at submission, not during a later save.
 * Identical camera names are disambiguated independently per destination.
 */
export interface ConnectedExportEntry {
  readonly item: ExportBatchItem;
  readonly frameIndex: number;
  readonly formatIndex: number;
}

export function platformExportFolder(format: Pick<ExportFormat, 'platform' | 'id'>): string {
  if (format.platform) return format.platform.charAt(0).toUpperCase() + format.platform.slice(1);
  return format.id === 'master' ? 'Master' : 'Custom';
}

export function planConnectedExports(
  frames: readonly PhotoFrame[], formats: readonly ExportFormat[], naming: NameTemplate,
): ConnectedExportEntry[] {
  const usedByFolder = new Map<string, Set<string>>();
  return frames.flatMap((frame, frameIndex) => {
    const stem = stemFor(naming, frame.filename, frameIndex, frames.length);
    return formats.map((format, formatIndex) => {
      const folder = platformExportFolder(format);
      const used = usedByFolder.get(folder.toLowerCase()) ?? new Set<string>();
      usedByFolder.set(folder.toLowerCase(), used);
      const raw = !frame.isDemo && isRawPreviewFile(frame.filename);
      const baseName = exportFilename(stem ? `${stem}.${format.format}` : frame.filename, toProfile(format), raw);
      const filename = uniqueExportFilename(baseName, used);
      return {
        item: { sourceId: `${frameIndex}:${formatIndex}`, filename, subfolder: folder },
        frameIndex, formatIndex,
      };
    });
  });
}

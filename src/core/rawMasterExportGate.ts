import { isRawPreviewFile } from './rawFormats';
import type { PhotoFrame } from './types';
import type { ExportFormat } from './exportFormats';

/**
 * A full-size PNG from the browser's 8-bit image source is not a verified
 * high-precision RAW master. The same rule must apply to manual downloads
 * and background exports; smaller named web/social exports remain available.
 */
export const RAW_MASTER_EXPORT_ERROR =
  'Full-size RAW export is not yet verified at original sensor quality. Choose Full size JPEG for an 8-bit sharing copy, or keep the original RAW until high-precision master export is supported.';

export function rawMasterExportBlocked(
  formats: readonly Pick<ExportFormat, 'id'>[],
  frames: readonly Pick<PhotoFrame, 'filename' | 'isDemo'>[],
): boolean {
  return formats.some(format => format.id === 'master') &&
    frames.some(frame => !frame.isDemo && isRawPreviewFile(frame.filename));
}

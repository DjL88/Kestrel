import type { ExportRequest } from '../ui/contract';

/**
 * The export request an enlargement preview renders: exactly one photo and one format, the edited picture with its
 * overlay and watermark, saved losslessly (PNG) so the preview carries no compression of its own. The preview then runs
 * the export's own job renderer (`renderExportJob`), so what it shows is the exported picture, not an approximation.
 */
export function enlargementPreviewRequest(photoId: string, sizeId: string): ExportRequest {
  return {
    photoIds: [photoId], sizeIds: [sizeId], groupIds: [], destination: 'local-individual', fileFormat: 'png',
    includeAfter: true, includeBefore: false, includeOriginal: false, includeOverlay: true, includeWatermark: true, includeVideo: false,
  };
}

/** What the canvas shows: the rendered file and its size, or why it could not be made. */
export type EnlargementPreviewResult =
  | { ok: true; url: string; width: number; height: number; name: string }
  | { ok: false; message: string };

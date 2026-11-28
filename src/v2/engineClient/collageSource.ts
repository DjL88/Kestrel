import { isHeifFile, isRawPreviewFile } from '../../core/rawFormats';
import { loadExportSource, loadVerifiedRasterOriginalForExport } from '../../providers/browserExport';
import type { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';
import type { PhotoFrame } from '../../core/types';
import { collageOutputText as T } from '../../i18n/areas/collageOutput';
import { readVerifiedExportOriginal } from './verifiedOriginalCopy';

export type CollageSourceProvider = Parameters<typeof loadExportSource>[1]
  & Pick<BrowserPreviewProvider, 'verifiedOriginalReader' | 'isDeveloped' | 'isOfflineFallback'>;

export interface CollageSourceDeps {
  loadExportSource: typeof loadExportSource;
  loadVerifiedRasterOriginalForExport: typeof loadVerifiedRasterOriginalForExport;
  readVerifiedExportOriginal: typeof readVerifiedExportOriginal;
}
const DEFAULT_DEPS: CollageSourceDeps = { loadExportSource, loadVerifiedRasterOriginalForExport, readVerifiedExportOriginal };

/**
 * The full-resolution picture for one collage window.
 *
 * - JPEG and PNG: the connected original, read and verified against its imported fingerprint (as before).
 * - RAW, only when `allowRaw`: the same steps as a single-photo export (scheduledPhotoExport.ts). The connected original
 *   is verified first, then developed from its sensor data by InFlight's decoder, an embedded camera preview is refused,
 *   and the original is checked again after the develop so a relinked or substituted file is never used.
 * - HEIF: refused, saying so; nothing is substituted.
 *
 * Without `allowRaw` a RAW is refused exactly as before (the collage export preview is off).
 */
export async function loadCollagePicture(
  frame: PhotoFrame, provider: CollageSourceProvider, signal: AbortSignal | undefined, allowRaw: boolean,
  deps: CollageSourceDeps = DEFAULT_DEPS,
): Promise<HTMLImageElement> {
  const raw = !frame.isDemo && isRawPreviewFile(frame.filename);
  if (!raw || !allowRaw) {
    if (allowRaw && !frame.isDemo && isHeifFile(frame.filename)) throw new Error(T.heif(frame.filename));
    return deps.loadVerifiedRasterOriginalForExport(frame, provider, signal);
  }
  const verified = await deps.readVerifiedExportOriginal(provider.verifiedOriginalReader(frame.stableKey), frame.originalSha256, frame.filename, signal);
  const image = await deps.loadExportSource(frame, provider);
  signal?.throwIfAborted();
  if (!provider.isDeveloped(frame.stableKey) || provider.isOfflineFallback(frame.stableKey)) throw new Error(T.embedded(frame.filename));
  verified.assertCurrent();
  return image;
}

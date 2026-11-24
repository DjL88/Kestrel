import { fullResolutionRasterFormat, isRawPreviewFile } from '../../core/rawFormats';
import type { PhotoFrame } from '../../core/types';
import type { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';

/** Never measure noise on an embedded RAW JPEG or cached review image. The supplied
 * original loader verifies JPEG/PNG bytes or develops RAW sensor pixels. */
export async function loadDenoiseSource<T>(
  frame: PhotoFrame,
  provider: Pick<BrowserPreviewProvider, 'getFullPreviewUrl' | 'isDeveloped' | 'isOfflineFallback'>,
  loadOriginal: () => Promise<T>, loadPreview: (url: string) => Promise<T>,
  signal?: AbortSignal,
): Promise<T | null> {
  if (signal?.aborted) return null;
  if (!frame.isDemo && isRawPreviewFile(frame.filename)) {
    const source = await loadOriginal();
    return signal?.aborted || !provider.isDeveloped(frame.stableKey) || provider.isOfflineFallback(frame.stableKey)
      ? null : source;
  }
  // JPEG/PNG can be decoded directly from SHA-verified original bytes, so a
  // resized review or substituted file cannot masquerade as a 1:1 noise sample.
  if (!frame.isDemo && fullResolutionRasterFormat(frame.filename)) {
    const source = await loadOriginal();
    return signal?.aborted ? null : source;
  }
  // Other supported raster formats use the connected decoder, never an offline review.
  const url = await provider.getFullPreviewUrl(frame, 'selected');
  if (!url || signal?.aborted || (!frame.isDemo && provider.isOfflineFallback(frame.stableKey))) return null;
  const source = await loadPreview(url);
  return signal?.aborted || (!frame.isDemo && provider.isOfflineFallback(frame.stableKey)) ? null : source;
}

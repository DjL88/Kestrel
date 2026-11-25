import { isRawPreviewFile } from '../../core/rawFormats';
import type { PhotoFrame } from '../../core/types';
import type { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';

/** A camera's embedded JPEG or offline review is not a valid source for RAW denoise. */
export async function loadDenoiseSource<T>(
  frame: PhotoFrame,
  provider: Pick<BrowserPreviewProvider, 'getFullPreviewUrl' | 'isDeveloped' | 'isOfflineFallback'>,
  loadDeveloped: () => Promise<T>, loadPreview: (url: string) => Promise<T>,
  signal?: AbortSignal,
): Promise<T | null> {
  if (signal?.aborted) return null;
  if (!frame.isDemo && isRawPreviewFile(frame.filename)) {
    const source = await loadDeveloped();
    return signal?.aborted || !provider.isDeveloped(frame.stableKey) || provider.isOfflineFallback(frame.stableKey)
      ? null : source;
  }
  // Non-RAW uses the normal source and its existing preview rules.
  const url = await provider.getFullPreviewUrl(frame, 'selected');
  if (!url || signal?.aborted) return null;
  const source = await loadPreview(url);
  return signal?.aborted ? null : source;
}

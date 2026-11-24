import { isHeifFile, isRawPreviewFile, looksLikeHeif } from '../../core/rawFormats';
import { hashOriginalBytes, isSameOriginalBytes } from '../../core/originalFileIdentity';
import type { PhotoFrame } from '../../core/types';
import type { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';

/** Never measure noise on an embedded RAW JPEG or cached review image. The supplied
 * original loader verifies raster bytes or develops RAW sensor pixels. */
export async function loadDenoiseSource<T>(
  frame: PhotoFrame,
  provider: Pick<BrowserPreviewProvider, 'getFullPreviewUrl' | 'isDeveloped' | 'isOfflineFallback'>,
  loadOriginal: () => Promise<T>, loadPreview: (url: string) => Promise<T>,
  signal?: AbortSignal,
): Promise<T | null> {
  if (signal?.aborted) return null;
  if (!frame.isDemo) {
    const source = await loadOriginal();
    if (signal?.aborted) return null;
    if (isRawPreviewFile(frame.filename) &&
        (!provider.isDeveloped(frame.stableKey) || provider.isOfflineFallback(frame.stableKey))) return null;
    return source;
  }
  // Only the explicitly labelled demo has no imported original to verify.
  const url = await provider.getFullPreviewUrl(frame, 'selected');
  if (!url || signal?.aborted) return null;
  const source = await loadPreview(url);
  return signal?.aborted ? null : source;
}

/** Decode additional raster formats from the verified original registration,
 * not a previously rendered review. The reader guards source generation
 * across asynchronous hashing and decoding. The decoder is injectable so
 * provenance can be tested independently of a device's HEIF capability. */
export async function loadVerifiedAdditionalDenoiseSource<T>(
  frame: PhotoFrame,
  reader: { isCurrent(): boolean; read(): Promise<Blob | undefined> },
  decode: (bytes: Blob, kind: 'heif' | 'webp') => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  const kind = isHeifFile(frame.filename) ? 'heif' : /\.webp$/i.test(frame.filename) ? 'webp' : null;
  if (!kind || frame.isDemo) throw new Error('This original format is not supported by the denoise source decoder.');
  if (!frame.originalSha256 || !/^[a-f0-9]{64}$/.test(frame.originalSha256)) {
    throw new Error(`Reimport ${frame.filename} to verify its original identity before denoise.`);
  }
  const original = await reader.read();
  signal?.throwIfAborted();
  if (!original || !reader.isCurrent()) throw new Error(`Reconnect ${frame.filename} before denoise.`);
  const header = new Uint8Array(await original.slice(0, 64).arrayBuffer());
  const four = (offset: number) => String.fromCharCode(...header.subarray(offset, offset + 4));
  const valid = kind === 'heif' ? looksLikeHeif(header) : header.length >= 12 && four(0) === 'RIFF' && four(8) === 'WEBP';
  if (!valid) throw new Error(`The connected original is not a valid ${kind.toUpperCase()} file.`);
  if (!isSameOriginalBytes(frame.originalSha256, await hashOriginalBytes(original, signal)) || !reader.isCurrent()) {
    throw new Error(`The connected original differs from the imported ${frame.filename}. Denoise was stopped.`);
  }
  const result = await decode(original, kind);
  signal?.throwIfAborted();
  if (!reader.isCurrent()) throw new Error('The original changed while it was being decoded. Retry denoise.');
  return result;
}

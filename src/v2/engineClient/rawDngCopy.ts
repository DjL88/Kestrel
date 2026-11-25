import { safeExportName } from '../../core/exportPlace';
import type { PhotoFrame } from '../../core/types';
import type { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';
import { rawDngCopy } from '../../providers/rawDevelop';

/**
 * A lossless DNG copy is offered only where it helps and can be made: a Nikon High Efficiency (HE or HE*) NEF, as its
 * own headers said, in the desktop app (its native decoder writes the DNG). Other RAWs already open everywhere.
 */
export function dngCopyOffered(frame: Pick<PhotoFrame, 'filename' | 'isDemo' | 'rawCodec'>, nativeRaw: boolean): boolean {
  return nativeRaw && !frame.isDemo && /\.nef$/i.test(frame.filename)
    && (frame.rawCodec === 'nikon-he' || frame.rawCodec === 'nikon-he-star');
}

/** Read the original (never written) and make its DNG copy in memory, named after it. */
export async function buildDngCopyFile(
  frame: PhotoFrame,
  provider: Pick<BrowserPreviewProvider, 'ensureOriginal'>,
  signal: AbortSignal,
  copy: (original: Blob) => Promise<Blob> = rawDngCopy,
): Promise<File> {
  const original = await provider.ensureOriginal(frame.stableKey, 'selected');
  if (!original) throw new Error(`Reconnect ${frame.filename} to make its DNG copy. The original is unchanged.`);
  signal.throwIfAborted();
  const dng = await copy(original);
  signal.throwIfAborted();
  if (!dng.size) throw new Error('The DNG copy came back empty, so nothing was saved. The original is unchanged.');
  return new File([dng], safeExportName(frame.filename.replace(/\.[^.]+$/, '') + '.dng'), { type: 'image/x-adobe-dng' });
}

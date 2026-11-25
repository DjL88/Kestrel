import { isRawPreviewFile } from '../../core/rawFormats';
import type { PhotoFrame } from '../../core/types';
import { loadExportSource } from '../../providers/browserExport';
import type { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';

/** A full-size develop can be made: a real RAW, InFlight's decoder on this device, and an original it can reach. */
export function fullDevelopPossible(frame: Pick<PhotoFrame, 'filename' | 'isDemo'>, decoderAvailable: boolean, originalReachable: boolean): boolean {
  return decoderAvailable && originalReachable && !frame.isDemo && isRawPreviewFile(frame.filename);
}

type DevelopProvider = Parameters<typeof loadExportSource>[1] & Pick<BrowserPreviewProvider, 'isDeveloped'>;

/**
 * Develop the RAW from its sensor data at full size, through the same path exports use (one decode shared with any
 * export already waiting for it). Fails in words unless the provider then holds a current full develop.
 */
export async function developFullSizeOf(frame: PhotoFrame, provider: DevelopProvider, load: typeof loadExportSource = loadExportSource): Promise<void> {
  await load(frame, provider);
  if (!provider.isDeveloped(frame.stableKey)) {
    throw new Error(`${frame.filename} was not developed at full size. Reconnect the original and try again; it is unchanged.`);
  }
}

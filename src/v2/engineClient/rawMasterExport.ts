import { safeExportName } from '../../core/exportPlace';
import { master16Blocker } from '../../core/master16';
import { DEFAULT_EDIT } from '../../core/photoEdits';
import { isRawPreviewFile } from '../../core/rawFormats';
import type { PhotoFrame } from '../../core/types';
import { canDevelopRaw } from '../../providers/rawDevelop';
import { loadExportSource } from '../../providers/browserExport';
import type { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';
import { exportRaw16Tiff } from '../../providers/rawMaster16';

/** Make a separate photo-wide RAW TIFF. Format-board sizing and overlays use a different renderer. */
export async function buildRawMasterFile(frame: PhotoFrame, provider: BrowserPreviewProvider, signal: AbortSignal): Promise<File> {
  if (frame.isDemo || !isRawPreviewFile(frame.filename) || !canDevelopRaw()) {
    throw new Error('Choose a connected RAW photo that InFlight can develop on this device.');
  }
  const originalSha256 = frame.originalSha256;
  if (!originalSha256 || !/^[a-f0-9]{64}$/.test(originalSha256)) {
    throw new Error('This photo has no verified original fingerprint. Import the original again before saving a RAW TIFF.');
  }
  const edit = frame.edit ?? DEFAULT_EDIT;
  const blocker = master16Blocker(edit, frame.framing);
  if (blocker) throw new Error(blocker);
  signal.throwIfAborted();
  const original = await provider.ensureOriginal(frame.stableKey, 'selected');
  if (!original) throw new Error('Reconnect the original RAW before saving its TIFF.');
  signal.throwIfAborted();
  const shown = await loadExportSource(frame, provider);
  const tiff = await exportRaw16Tiff(original, frame.filename, shown, edit, frame.framing, null, { originalSha256, signal });
  signal.throwIfAborted();
  return new File([tiff], safeExportName(frame.filename.replace(/\.[^.]+$/, '') + '_16bit.tif'), { type: tiff.type });
}

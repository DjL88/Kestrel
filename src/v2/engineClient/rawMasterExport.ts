import { safeExportName } from '../../core/exportPlace';
import { master16Blocker } from '../../core/master16';
import { frameLayers, visibleLayers } from '../../core/layers';
import { DEFAULT_EDIT } from '../../core/photoEdits';
import { isRawPreviewFile } from '../../core/rawFormats';
import type { PhotoFrame } from '../../core/types';
import { canDevelopRaw } from '../../providers/rawDevelop';
import { loadExportSource } from '../../providers/browserExport';
import type { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';
import { exportRaw16Png, exportRaw16Tiff } from '../../providers/rawMaster16';

/** Make a separate photo-wide 16-bit RAW TIFF or PNG. Format-board sizing and overlays use a different renderer. */
export async function buildRawMasterFile(frame: PhotoFrame, provider: BrowserPreviewProvider, signal: AbortSignal, format: 'tiff' | 'png' = 'tiff'): Promise<File> {
  if (frame.isDemo || !isRawPreviewFile(frame.filename) || !canDevelopRaw()) {
    throw new Error('Choose a connected RAW photo that InFlight can develop on this device.');
  }
  const originalSha256 = frame.originalSha256;
  if (!originalSha256 || !/^[a-f0-9]{64}$/.test(originalSha256)) {
    throw new Error('This photo has no verified original fingerprint. Import the original again before saving a 16-bit RAW file.');
  }
  const edit = frame.edit ?? DEFAULT_EDIT;
  // Layers are composed by the 8-bit/16-bit canvas renderer only; the archival 16-bit RAW file is the photo alone, so say so.
  if (visibleLayers(frameLayers(frame.overlay)).length) throw new Error('The 16-bit RAW file is the photo alone and cannot include layers yet. Hide the layers to save it, or export a JPEG, PNG or TIFF from Export.');
  const blocker = master16Blocker(edit, frame.framing);
  if (blocker) throw new Error(blocker);
  signal.throwIfAborted();
  const original = await provider.ensureOriginal(frame.stableKey, 'selected');
  if (!original) throw new Error('Reconnect the original RAW before saving its 16-bit file.');
  signal.throwIfAborted();
  const shown = await loadExportSource(frame, provider);
  const file = format === 'png'
    ? await exportRaw16Png(original, frame.filename, shown, edit, frame.framing, { originalSha256, signal })
    : await exportRaw16Tiff(original, frame.filename, shown, edit, frame.framing, null, { originalSha256, signal });
  signal.throwIfAborted();
  const suffix = format === 'png' ? '_16bit.png' : '_16bit.tif';
  return new File([file], safeExportName(frame.filename.replace(/\.[^.]+$/, '') + suffix), { type: file.type });
}

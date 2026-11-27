import { applyCanvasExportEdit } from '../../core/canvasEdit';
import { applyFrameLayers } from '../../core/layerAssetVault';
import { DEFAULT_EDIT } from '../../core/photoEdits';
import { DEFAULT_FRAMING, drawFramedPhoto, framedSize, lensCentre } from '../../core/photoFraming';
import { isRawPreviewFile } from '../../core/rawFormats';
import type { PhotoFrame } from '../../core/types';
import { loadExportSource } from '../../providers/browserExport';
import type { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';
import { loadImage } from '../../providers/loadImage';

/** Long edge of a client gallery preview. Sized for viewing on a screen, never the full-resolution photograph. */
export const GALLERY_PREVIEW_EDGE = 2048;

/**
 * The edited photograph as a client will see it: framed, with the current edit and masks, at most 2048 px on the long
 * edge, as JPEG. Null when there is no trustworthy picture yet: a RAW whose sensor data has not been developed on this
 * device is not published from its embedded preview.
 */
export async function renderGalleryPreview(frame: PhotoFrame, provider: BrowserPreviewProvider, signal?: AbortSignal, edge = GALLERY_PREVIEW_EDGE): Promise<Blob | null> {
  const raw = !frame.isDemo && isRawPreviewFile(frame.filename);
  const url = raw ? null : await provider.getFullPreviewUrl(frame, 'selected');
  if (!raw && !url) return null;
  const source = raw ? await loadExportSource(frame, provider) : await loadImage(url!);
  if (raw && (!provider.isDeveloped(frame.stableKey) || provider.isOfflineFallback(frame.stableKey))) return null;
  signal?.throwIfAborted();
  const framing = frame.framing ?? DEFAULT_FRAMING;
  const { width, height } = framedSize(source.naturalWidth, source.naturalHeight, framing);
  const scale = Math.min(1, edge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  drawFramedPhoto(source, canvas, framing, { scale });
  await applyCanvasExportEdit(canvas, frame.edit ?? DEFAULT_EDIT, signal, Math.max(width, height) * scale, { aspect: height / width, view: { x: 0, y: 0, w: 1, h: 1 }, lensCentre: lensCentre(source.naturalWidth, source.naturalHeight, framing) });
  signal?.throwIfAborted();
  await applyFrameLayers(canvas, frame.overlay, true, frame.edit?.masks);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.86));
}


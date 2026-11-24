import { COLLAGE_FORMATS, type CollageDocument } from '../../core/collage';
import { renderCollagePage, encodeCollagePage, type CollageImage } from '../../core/collagePageRender';
import { collagePdf, type PdfRasterPage } from '../../core/collagePdf';
import { planCollagePrint } from '../../core/collagePrint';
import { fitScale, maxCanvasPixels } from '../../core/exportLimits';
import { applyCanvasExportEdit } from '../../core/canvasEdit';
import { DEFAULT_EDIT } from '../../core/photoEdits';
import { DEFAULT_FRAMING, drawFramedPhoto, framedSize } from '../../core/photoFraming';
import { fullResolutionRasterFormat, isRawPreviewFile, isHeifFile } from '../../core/rawFormats';
import type { PhotoFrame } from '../../core/types';
import { loadExportSource, loadVerifiedRasterOriginalForExport } from '../../providers/browserExport';
import type { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';
import { verifyExactOriginalCopy } from './verifiedOriginalCopy';

export type CollageExportType = 'jpeg' | 'png' | 'pdf';
const deviceLimit = () => maxCanvasPixels({
  userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints,
});

async function verifiedSource(
  frame: PhotoFrame, provider: BrowserPreviewProvider, printing: boolean, signal: AbortSignal,
): Promise<HTMLImageElement> {
  signal.throwIfAborted();
  if (!frame.isDemo && fullResolutionRasterFormat(frame.filename)) {
    // This checks the original file header and its saved SHA-256, not a cached thumbnail.
    return loadVerifiedRasterOriginalForExport(frame, provider, signal);
  }
  if (frame.isDemo && !printing) {
    return loadExportSource(frame, provider, 'selected');
  }
  if (frame.isDemo || isHeifFile(frame.filename)) {
    throw new Error(`${frame.filename} has no verified full-resolution source for collage export. Reconnect a JPEG/PNG original or develop a supported RAW.`);
  }
  if (!isRawPreviewFile(frame.filename)) {
    throw new Error(`Cannot verify the full-resolution source of ${frame.filename}.`);
  }
  // Check the actual original RAW bytes before using the engine's sensor development.
  const bytes = await provider.ensureOriginal(frame.stableKey, 'selected');
  if (!bytes) throw new Error(`Reconnect the original RAW ${frame.filename} before collage export.`);
  await verifyExactOriginalCopy(bytes, frame.originalSha256, signal);
  const image = await loadExportSource(frame, provider, 'selected');
  if (!provider.isDeveloped(frame.stableKey)) {
    throw new Error(`${frame.filename} has only a camera JPEG preview, not a verified developed RAW image. Export was stopped.`);
  }
  signal.throwIfAborted();
  return image;
}

/** Renders a genuine developed photo through the normal non-destructive edit/mask pipeline.
 * The composition renderer releases the intermediate canvas after using each window. */
async function editedSource(
  photoId: string, frames: readonly PhotoFrame[], provider: BrowserPreviewProvider,
  printing: boolean, signal: AbortSignal, socialMaxEdge: number,
): Promise<CollageImage> {
  signal.throwIfAborted();
  const frame = frames.find((candidate) => candidate.id === photoId && candidate.removedAt == null);
  if (!frame) throw new Error('A collage window references a missing photograph. Replace it before exporting.');
  const original = await verifiedSource(frame, provider, printing, signal);
  const framing = frame.framing ?? DEFAULT_FRAMING;
  const { width, height } = framedSize(original.naturalWidth, original.naturalHeight, framing);
  if (!(width > 0 && height > 0)) throw new Error(`Invalid full-resolution image geometry for ${frame.filename}.`);
  // Social pages have a fixed output size; do not process every 45 MP source at
  // full resolution merely to fill a 1080 px window. Print uses all available
  // genuine pixels (subject to the device canvas cap) for its strict PPI check.
  const scale = Math.min(fitScale(width, height, deviceLimit()),
    printing ? 1 : Math.min(1, socialMaxEdge / Math.max(width, height)));
  const canvas = document.createElement('canvas');
  try {
    drawFramedPhoto(original, canvas, framing, { scale, colourSpace: 'srgb' });
    await applyCanvasExportEdit(canvas, frame.edit ?? DEFAULT_EDIT, signal, Math.max(width, height) * scale,
      { aspect: height / width, view: { x: 0, y: 0, w: 1, h: 1 } });
    signal.throwIfAborted();
    return {
      image: canvas, width: canvas.width, height: canvas.height,
      release: () => { canvas.width = 0; canvas.height = 0; },
    };
  } catch (error) {
    canvas.width = 0; canvas.height = 0;
    throw error;
  }
}

/** Returns actually composited page files. Print PDF is RGB raster at 300 PPI with
 * physical BleedBox and TrimBox; it is not PDF/X or colour-managed CMYK prepress. */
export async function exportCollage(
  document: CollageDocument, frames: readonly PhotoFrame[], provider: BrowserPreviewProvider,
  type: CollageExportType, signal: AbortSignal, onPage?: (finished: number) => void,
): Promise<File[]> {
  const format = COLLAGE_FORMATS[document.format];
  const printing = type === 'pdf';
  if (printing !== (format.unit === 'mm')) {
    throw new Error(printing ? 'Choose a physical print page size to export a PDF.' : 'Choose a social page size to export JPEG/PNG pages.');
  }
  if (document.pages.length === 0 || document.pages.length > 40) {
    throw new Error('Export between 1 and 40 collage pages at a time.');
  }
  const result: File[] = [];
  const pdfPages: PdfRasterPage[] = [];
  const pdfPlan = printing ? planCollagePrint(document.format, 300, 3) : null;
  for (const [index, page] of document.pages.entries()) {
    signal.throwIfAborted();
    const canvas = await renderCollagePage(document, page,
      (id) => editedSource(id, frames, provider, printing, signal, Math.max(format.width, format.height) * 1.5), printing, signal);
    try {
      const mime = printing ? 'jpeg' : type;
      const blob = await encodeCollagePage(canvas, mime as 'jpeg' | 'png');
      signal.throwIfAborted();
      if (printing) {
        pdfPages.push({ jpeg: blob, width: canvas.width, height: canvas.height });
      } else {
        result.push(new File([blob], `inflight-collage-page-${String(index + 1).padStart(2, '0')}.${type === 'png' ? 'png' : 'jpg'}`,
          { type: blob.type, lastModified: Date.now() }));
      }
      onPage?.(index + 1);
    } finally {
      canvas.width = 0; canvas.height = 0;
    }
  }
  if (pdfPlan) {
    const file = collagePdf(pdfPages, pdfPlan);
    result.push(new File([file], 'inflight-photo-album.pdf', { type: 'application/pdf', lastModified: Date.now() }));
  }
  return result;
}

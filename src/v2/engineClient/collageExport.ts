import type { CollageDocument, CollagePage, CollageSlot } from '../../core/collage';
import { COLLAGE_FORMATS } from '../../core/collage';
import { planCollagePrint, printSlotResolution, printResolutionMessage } from '../../core/collagePrint';
import { maxCanvasPixels } from '../../core/exportLimits';
import { applyCanvasExportEdit } from '../../core/canvasEdit';
import { DEFAULT_EDIT } from '../../core/photoEdits';
import { DEFAULT_FRAMING, drawFramedPhoto, framedSize } from '../../core/photoFraming';
import { isRawPreviewFile, fullResolutionRasterFormat, isHeifFile } from '../../core/rawFormats';
import type { PhotoFrame } from '../../core/types';
import type { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';
import { loadExportSource, loadVerifiedRasterOriginalForExport } from '../../providers/browserExport';
import { assembleAlbumPdf, type PdfRasterPage } from '../../core/collagePdf';

type Output = 'png' | 'jpeg' | 'pdf';
interface PageLayout { width: number; height: number; bleedX: number; bleedY: number; trimWidth: number; trimHeight: number }
const getLimit = () => maxCanvasPixels({ userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints });
function layoutFor(doc: CollageDocument, output: Output): PageLayout {
  const format = COLLAGE_FORMATS[doc.format];
  if (output === 'pdf') {
    const planned = planCollagePrint(doc.format);
    const width = planned.targetPixels.width, height = planned.targetPixels.height;
    const bleedX = Math.round(width * planned.bleedMm / planned.mediaWidthMm);
    const bleedY = Math.round(height * planned.bleedMm / planned.mediaHeightMm);
    return { width, height, bleedX, bleedY, trimWidth: width - bleedX * 2, trimHeight: height - bleedY * 2 };
  }
  if (format.unit === 'mm') throw new Error('Choose a social page size for PNG or JPEG, or use Print PDF for album pages.');
  return { width: format.width, height: format.height, bleedX: 0, bleedY: 0, trimWidth: format.width, trimHeight: format.height };
}
function slotBounds(slot: CollageSlot, page: CollagePage, l: PageLayout) {
  const gap = page.gap / 2;
  return {
    x: l.bleedX + (slot.x + gap) / 100 * l.trimWidth,
    y: l.bleedY + (slot.y + gap) / 100 * l.trimHeight,
    width: Math.max(1, (slot.width - 2 * gap) / 100 * l.trimWidth),
    height: Math.max(1, (slot.height - 2 * gap) / 100 * l.trimHeight),
  };
}
function clipSlot(ctx: CanvasRenderingContext2D, slot: CollageSlot, w: number, h: number) {
  ctx.beginPath();
  if (!slot.clip) { ctx.rect(-w / 2, -h / 2, w, h); return; }
  const points = [...slot.clip.matchAll(/(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%/g)];
  if (points.length < 3) { ctx.rect(-w / 2, -h / 2, w, h); return; }
  points.forEach((m, i) => {
    const x = (Number(m[1]) / 100 - 0.5) * w, y = (Number(m[2]) / 100 - 0.5) * h;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath();
}
function labelLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const maybe = line ? line + ' ' + word : word;
      if (line && ctx.measureText(maybe).width > maxWidth) { lines.push(line); line = word; }
      else line = maybe;
    }
    lines.push(line);
  }
  return lines;
}
async function sourceForPrint(frame: PhotoFrame, provider: BrowserPreviewProvider, signal: AbortSignal): Promise<HTMLImageElement> {
  signal.throwIfAborted();
  if (!frame.isDemo && fullResolutionRasterFormat(frame.filename)) {
    return loadVerifiedRasterOriginalForExport(frame, provider, signal);
  }
  if (frame.isDemo || isHeifFile(frame.filename)) {
    throw new Error(`${frame.filename} has no verified full-resolution decoder for collage export. Use a connected JPEG/PNG or a genuinely developed RAW.`);
  }
  if (!isRawPreviewFile(frame.filename)) throw new Error(`Cannot verify the full-resolution source for ${frame.filename}.`);
  const image = await loadExportSource(frame, provider, 'selected');
  if (!provider.isDeveloped(frame.stableKey)) {
    throw new Error(`${frame.filename} is only an embedded RAW preview. Develop the original RAW before exporting a collage.`);
  }
  signal.throwIfAborted();
  return image;
}
/** Returns a full-resolution, 8-bit RGB collage page, composed using the same non-generative photo edit engine. */
export async function renderCollagePage(
  doc: CollageDocument, page: CollagePage, frames: readonly PhotoFrame[], provider: BrowserPreviewProvider,
  output: Output, signal: AbortSignal,
): Promise<HTMLCanvasElement> {
  const l = layoutFor(doc, output);
  if (l.width * l.height > getLimit()) throw new Error(`This device cannot render a ${l.width} × ${l.height} page. Export on a desktop or choose a smaller size.`);
  const canvas = document.createElement('canvas');
  canvas.width = l.width; canvas.height = l.height;
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  if (!ctx) throw new Error('Could not create the collage export canvas.');
  try {
    ctx.fillStyle = page.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const slot of page.slots) {
      signal.throwIfAborted();
      if (!slot.photoId) continue;
      const frame = frames.find((candidate) => candidate.id === slot.photoId && candidate.removedAt == null);
      if (!frame) throw new Error('A collage page references a missing photograph. Replace it before exporting.');
      const box = slotBounds(slot, page, l);
      const original = await sourceForPrint(frame, provider, signal);
      const framing = frame.framing ?? DEFAULT_FRAMING;
      const { width: fw, height: fh } = framedSize(original.naturalWidth, original.naturalHeight, framing);
      if (!(fw > 0 && fh > 0)) throw new Error(`Invalid decoded image size for ${frame.filename}.`);
      const requiredScale = Math.max(box.width / fw, box.height / fh);
      if (output === 'pdf') {
        const format = COLLAGE_FORMATS[doc.format];
        const resolution = printSlotResolution({ width: fw, height: fh },
          { width: box.width / l.trimWidth * format.width, height: box.height / l.trimHeight * format.height });
        const warning = printResolutionMessage(resolution, 300);
        if (warning) throw new Error(`Page ${doc.pages.indexOf(page) + 1} · ${frame.filename}: ${warning}`);
      }
      const framed = document.createElement('canvas');
      try {
        // The source is never upscaled before edits; masks and sharpening use the normal engine.
        const scale = Math.min(1, requiredScale);
        const pixels = Math.round(fw * scale) * Math.round(fh * scale);
        const safeScale = pixels > getLimit() ? Math.min(scale, Math.sqrt(getLimit() / (fw * fh)) * 0.999) : scale;
        drawFramedPhoto(original, framed, framing, { scale: safeScale, colourSpace: 'srgb' });
        await applyCanvasExportEdit(framed, frame.edit ?? DEFAULT_EDIT, signal, Math.max(fw, fh) * safeScale,
          { aspect: fh / fw, view: { x: 0, y: 0, w: 1, h: 1 } });
        signal.throwIfAborted();
        ctx.save();
        try {
          ctx.translate(box.x + box.width / 2, box.y + box.height / 2);
          ctx.rotate(slot.angle * Math.PI / 180);
          clipSlot(ctx, slot, box.width, box.height);
          ctx.clip();
          const imageScale = Math.max(box.width / framed.width, box.height / framed.height);
          const imageWidth = framed.width * imageScale, imageHeight = framed.height * imageScale;
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(framed, -imageWidth / 2, -imageHeight / 2, imageWidth, imageHeight);
        } finally { ctx.restore(); }
      } finally { framed.width = 0; framed.height = 0; }
    }
    if (page.caption.trim()) {
      await document.fonts?.ready;
      signal.throwIfAborted();
      ctx.save();
      ctx.font = `600 ${Math.max(16, Math.round(l.trimWidth * 0.026))}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillStyle = page.captionColour; ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = Math.max(2,l.width * 0.003);
      const lines = labelLines(ctx, page.caption, l.trimWidth * .9);
      const lineHeight = Math.max(20, l.trimWidth * 0.038);
      const yBottom = l.bleedY + l.trimHeight * .965;
      for (const [i, line] of lines.slice(-8).entries()) {
        ctx.fillText(line, l.width / 2, yBottom - (Math.min(8, lines.length) - 1 - i) * lineHeight);
      }
      ctx.restore();
    }
    return canvas;
  } catch (error) { canvas.width = 0; canvas.height = 0; throw error; }
}
function encodeCanvas(canvas: HTMLCanvasElement, mime: 'image/png' | 'image/jpeg'): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob?.size && blob.type === mime
    ? resolve(blob) : reject(new Error('The canvas could not encode a real page image.')), mime, mime === 'image/jpeg' ? 0.96 : undefined));
}
/** Every output is a genuine composited raster page or one physical multi-page PDF. */
export async function exportCollage(
  doc: CollageDocument, frames: readonly PhotoFrame[], provider: BrowserPreviewProvider, output: Output,
  signal: AbortSignal, onPage?: (complete: number) => void,
): Promise<File[]> {
  if (!doc.pages.length) throw new Error('Add a page before exporting.');
  const format = COLLAGE_FORMATS[doc.format];
  const isPrint = format.unit === 'mm';
  if (isPrint !== (output === 'pdf')) throw new Error(isPrint ? 'Print pages must export as PDF.' : 'Choose a physical page size for a print PDF.');
  const names = new Set<string>();
  const makeName = (n: number, extension: string) => {
    const candidate = `inflight-${isPrint ? 'album' : 'collage'}-${String(n).padStart(2, '0')}.${extension}`;
    if (names.has(candidate)) throw new Error('Duplicate output name.'); names.add(candidate); return candidate;
  };
  const files: File[] = [], pdfPages: PdfRasterPage[] = [];
  for (const [i, page] of doc.pages.entries()) {
    signal.throwIfAborted();
    const raster = await renderCollagePage(doc, page, frames, provider, output, signal);
    try {
      const mime = output === 'png' ? 'image/png' : 'image/jpeg';
      const blob = await encodeCanvas(raster, mime);
      signal.throwIfAborted();
      if (output === 'pdf') {
        const plan = planCollagePrint(doc.format);
        pdfPages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()),
          pixels: { width: raster.width, height: raster.height },
          mediaMm: { width: plan.mediaWidthMm, height: plan.mediaHeightMm }, bleedMm: plan.bleedMm });
      } else {
        files.push(new File([blob], makeName(i + 1, output === 'png' ? 'png' : 'jpg'),
          { type: mime, lastModified: Date.now() }));
      }
      onPage?.(i + 1);
    } finally { raster.width = 0; raster.height = 0; }
  }
  if (output === 'pdf') {
    const bytes = assembleAlbumPdf(pdfPages);
    files.push(new File([bytes as Uint8Array<ArrayBuffer>], 'inflight-photo-album.pdf',
      { type: 'application/pdf', lastModified: Date.now() }));
  }
  return files;
}

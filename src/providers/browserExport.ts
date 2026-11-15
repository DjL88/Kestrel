import { isNikonEmbeddedPreviewFile } from '../core/exifParser';
import { loadImage } from './loadImage';
import { applyCanvasExportEdit } from '../core/canvasEdit';
import { DEFAULT_EDIT } from '../core/photoEdits';
import { DEFAULT_FRAMING, drawFramedPhoto, framedSize } from '../core/photoFraming';
import { exportFilename, type ExportProfile } from '../core/exportProfiles';
import { planExportFraming, type ExportFraming, type FocusPoint } from '../core/exportFraming';
import type { BarStyle } from '../core/exportFormats';
import { overlayLines, type OverlayOptions } from '../core/exportOverlay';
import { datedExport } from '../core/exportTimestamp';
import type { PhotoFrame } from '../core/types';
import type { BrowserPreviewProvider } from './browserPreviewProvider';

export async function loadExportSource(frame: PhotoFrame, provider: Pick<BrowserPreviewProvider, 'getFullPreviewUrl' | 'hasBlob'>) {
  const url = await provider.getFullPreviewUrl(frame);
  if (!url && !frame.isDemo && isNikonEmbeddedPreviewFile(frame.filename) && provider.hasBlob(frame.stableKey)) {
    throw new Error(`${frame.filename} has no usable embedded JPEG. Export it from a RAW developer and import the rendered photo.`);
  }
  if (!url) throw new Error(`Reconnect ${frame.filename} to export it.`);
  return loadImage(url);
}

export interface ExportExtras {
  /** Where to centre a crop. Falls back to the photo's saved focus point, then the middle. */
  focus?: FocusPoint;
  /** What goes in the borders when the whole photo is kept inside a fixed shape. */
  bars?: BarStyle;
  /** A file name to use instead of the photo's own, without the extension. */
  stem?: string;
  /** Shooting details printed on the picture. */
  overlay?: OverlayOptions;
  /** How far in the crop looks, from 1 (as much as the shape allows) to 4. */
  zoom?: number;
  /** Limit the long edge of the generated preview. */
  previewEdge?: number;
}

/**
 * Draw one export: crop or fit as planned, apply the edit, and add borders. Previews and real exports both come
 * through here, so a preview shows exactly the crop the file will have.
 */
async function composeExport(
  source: HTMLImageElement, frame: PhotoFrame, profile: ExportProfile, signal: AbortSignal | undefined,
  mode: ExportFraming, longEdge: number | undefined, extras: ExportExtras,
) {
  signal?.throwIfAborted();
  const framing = frame.framing ?? DEFAULT_FRAMING;
  const { width, height } = framedSize(source.naturalWidth, source.naturalHeight, framing);
  const plan = planExportFraming(width, height, profile, mode, extras.focus ?? frame.focusPoint, longEdge, extras.zoom);
  const { region } = plan;
  let { scale, border } = plan;
  if (extras.previewEdge) {
    const finalWidth = border ? border.width : region.width * scale;
    const finalHeight = border ? border.height : region.height * scale;
    const shrink = Math.min(1, extras.previewEdge / Math.max(finalWidth, finalHeight));
    scale *= shrink;
    if (border) border = { width: Math.max(1, Math.round(border.width * shrink)), height: Math.max(1, Math.round(border.height * shrink)) };
  }
  const canvas = document.createElement('canvas');
  const output = border ? document.createElement('canvas') : canvas;
  drawFramedPhoto(source, canvas, framing, { scale, region });
  // The crop shows only part of the framed photo, so tell the edit which part. Masks and detail then match the full photo.
  await applyCanvasExportEdit(canvas, frame.edit ?? DEFAULT_EDIT, signal, Math.max(width, height) * scale, {
    aspect: height / width,
    view: { x: region.x / width, y: region.y / height, w: region.width / width, h: region.height / height },
  });
  signal?.throwIfAborted();
  if (border) {
    output.width = border.width;
    output.height = border.height;
    const context = output.getContext('2d')!;
    const style = extras.bars ?? 'white';
    if (style === 'blur' && 'filter' in context) {
      // A blurred, darkened copy of the photo fills the borders. Nothing is invented: it is the same picture.
      const cover = Math.max(output.width / canvas.width, output.height / canvas.height) * 1.15;
      context.filter = `blur(${Math.max(2, Math.round(output.width / 40))}px)`;
      context.drawImage(canvas, (output.width - canvas.width * cover) / 2, (output.height - canvas.height * cover) / 2, canvas.width * cover, canvas.height * cover);
      context.filter = 'none';
      context.fillStyle = 'rgba(0, 0, 0, 0.28)';
      context.fillRect(0, 0, output.width, output.height);
    } else {
      context.fillStyle = style === 'black' ? '#000000' : '#ffffff';
      context.fillRect(0, 0, output.width, output.height);
    }
    context.drawImage(canvas, Math.floor((output.width - canvas.width) / 2), Math.floor((output.height - canvas.height) / 2));
  }
  if (extras.overlay?.on) {
    const lines = overlayLines(frame.exif, extras.overlay);
    if (lines.length) drawOverlay(output, lines, extras.overlay);
  }
  return { canvas, output, bordered: Boolean(border) };
}

/** Print lines of text over the bottom or top of a picture, on a soft fade so they stay readable on any photo. */
function drawOverlay(target: HTMLCanvasElement, lines: string[], options: OverlayOptions) {
  const context = target.getContext('2d');
  if (!context) return;
  const { width, height } = target;
  let size = Math.max(10, Math.round(Math.min(width, height) * 0.032 * (options.scale ?? 1)));
  const family = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
  // Shrink the text if the longest line would not fit.
  context.font = `500 ${size}px ${family}`;
  const widest = Math.max(...lines.map((line) => context.measureText(line).width));
  if (widest > width * 0.92 - size * 2) size = Math.max(8, Math.floor(size * ((width * 0.92 - size * 2) / widest)));
  const lineHeight = size * 1.4, pad = size * 1.1;
  const block = lines.length * lineHeight + pad * 2;
  const bottom = options.place === 'bottom';
  const fade = context.createLinearGradient(0, bottom ? height - block * 1.6 : 0, 0, bottom ? height : block * 1.6);
  const shade = options.tone === 'light' ? '0, 0, 0' : '255, 255, 255';
  fade.addColorStop(bottom ? 0 : 1, `rgba(${shade}, 0)`);
  fade.addColorStop(bottom ? 1 : 0, `rgba(${shade}, ${options.shade ?? 0.62})`);
  context.fillStyle = fade;
  context.fillRect(0, bottom ? height - block * 1.6 : 0, width, block * 1.6);
  context.fillStyle = options.tone === 'light' ? '#ffffff' : '#111111';
  context.textBaseline = 'alphabetic';
  const alignment = options.align ?? 'left';
  context.textAlign = alignment === 'centre' ? 'center' : alignment;
  const x = alignment === 'centre' ? width / 2 : alignment === 'right' ? width - pad : pad;
  lines.forEach((line, index) => {
    context.font = `${index === 0 ? 600 : 500} ${size}px ${family}`;
    const y = bottom ? height - pad - (lines.length - 1 - index) * lineHeight : pad + size + index * lineHeight;
    context.fillText(line, x, y, width - pad * 2);
  });
}

/**
 * A quick, unedited draw of the crop, for while a picture is being dragged. It is cheap enough to run on every frame.
 * The finished preview, with the edit applied, replaces it a moment after the drag stops.
 */
export function drawCropQuickly(source: HTMLImageElement, frame: PhotoFrame, profile: ExportProfile, extras: ExportExtras, target: HTMLCanvasElement) {
  const framing = frame.framing ?? DEFAULT_FRAMING;
  const { width, height } = framedSize(source.naturalWidth, source.naturalHeight, framing);
  const plan = planExportFraming(width, height, profile, 'focus', extras.focus ?? frame.focusPoint, undefined, extras.zoom);
  const finalWidth = plan.region.width * plan.scale, finalHeight = plan.region.height * plan.scale;
  const shrink = Math.min(1, 240 / Math.max(finalWidth, finalHeight));
  drawFramedPhoto(source, target, framing, { scale: plan.scale * shrink, region: plan.region });
}

/** A small picture of what an export will look like, as a canvas the caller can draw. */
export async function renderExportPreview(
  source: HTMLImageElement, frame: PhotoFrame, profile: ExportProfile, mode: ExportFraming, extras: ExportExtras = {}, signal?: AbortSignal,
): Promise<HTMLCanvasElement> {
  const { canvas, output, bordered } = await composeExport(source, frame, profile, signal, mode, undefined, { previewEdge: 240, ...extras });
  if (bordered) { canvas.width = 0; canvas.height = 0; }
  return output;
}

export async function renderExport(
  source: HTMLImageElement, frame: PhotoFrame, profile: ExportProfile, date: Date, signal?: AbortSignal,
  mode: ExportFraming = 'fit', longEdge?: number, extras: ExportExtras = {},
) {
  const mime = profile.format === 'png' ? 'image/png' : 'image/jpeg';
  const { canvas, output, bordered } = await composeExport(source, frame, profile, signal, mode, longEdge, extras);
  try {
    const raw = !frame.isDemo && /\.(nef|nrw)$/i.test(frame.filename);
    const name = exportFilename(extras.stem ? `${extras.stem}.${profile.format}` : frame.filename, profile, raw);
    for (const quality of profile.maxBytes ? [profile.quality, ...[0.88, 0.82, 0.74, 0.65].filter((value) => value < profile.quality)] : [profile.quality]) {
      signal?.throwIfAborted();
      const encoded = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, mime, quality));
      signal?.throwIfAborted();
      if (!encoded || encoded.type !== mime) throw new Error(`Could not encode ${name} at ${output.width} × ${output.height} px.`);
      const file = datedExport(encoded, name, date);
      if (!profile.maxBytes || file.size <= profile.maxBytes) return file;
    }
    throw new Error(`${name} is above the preset’s file-size limit. Choose smaller export dimensions.`);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    if (bordered) { output.width = 0; output.height = 0; }
  }
}

export function downloadExport(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function archiveExports(files: File[]) {
  const { Zip, ZipPassThrough } = await import('fflate');
  const chunks: BlobPart[] = [];
  let result: Blob | undefined;
  let failure: Error | undefined;
  const zip = new Zip((error, chunk, done) => {
    if (error) { failure = error; return; }
    chunks.push(new Uint8Array(chunk));
    if (done) result = new Blob(chunks, { type: 'application/zip' });
  });
  const names = new Set<string>();
  for (const file of files) {
    let name = file.name;
    let number = 2;
    const dot = name.lastIndexOf('.');
    while (names.has(name)) name = `${file.name.slice(0, dot)}-${number++}${file.name.slice(dot)}`;
    names.add(name);
    const entry = new ZipPassThrough(name);
    const date = new Date(file.lastModified);
    entry.mtime = date.getFullYear() >= 1980 && date.getFullYear() <= 2099 ? date : undefined;
    zip.add(entry);
    const reader = file.stream().getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        entry.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    entry.push(new Uint8Array(), true);
  }
  zip.end();
  if (failure || !result) throw failure ?? new Error('Could not create the export archive.');
  return result;
}

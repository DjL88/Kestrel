import { loadImage } from './loadImage';
import { applyCanvasExportEdit } from '../core/canvasEdit';
import { DEFAULT_EDIT } from '../core/photoEdits';
import { DEFAULT_FRAMING, drawFramedPhoto, framedSize } from '../core/photoFraming';
import { exportFilename, type ExportProfile } from '../core/exportProfiles';
import { planExportFraming, type ExportFraming, type FocusPoint } from '../core/exportFraming';
import type { BarStyle } from '../core/exportFormats';
import { datedExport } from '../core/exportTimestamp';
import type { PhotoFrame } from '../core/types';
import type { BrowserPreviewProvider } from './browserPreviewProvider';

export async function loadExportSource(frame: PhotoFrame, provider: BrowserPreviewProvider) {
  const url = await provider.getFullPreviewUrl(frame);
  if (!url) throw new Error(`Reconnect ${frame.filename} to export it.`);
  return loadImage(url);
}

export interface ExportExtras {
  /** Where to centre a crop. Falls back to the photo's saved focus point, then the middle. */
  focus?: FocusPoint;
  /** What goes in the borders when the whole photo is kept inside a fixed shape. */
  bars?: BarStyle;
  /** Make a small version no larger than this on its long side, for previews. */
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
  const plan = planExportFraming(width, height, profile, mode, extras.focus ?? frame.focusPoint, longEdge);
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
  return { canvas, output, bordered: Boolean(border) };
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
    const name = exportFilename(frame.filename, profile, raw);
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

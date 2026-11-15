import { applyCanvasExportEdit, DEFAULT_EDIT } from '../core/photoEdits';
import { DEFAULT_FRAMING, drawFramedPhoto, framedSize } from '../core/photoFraming';
import { exportFilename, exportScale, type ExportProfile } from '../core/exportProfiles';
import { datedExport } from '../core/exportTimestamp';
import type { PhotoFrame } from '../core/types';
import type { BrowserPreviewProvider } from './browserPreviewProvider';

export async function loadExportSource(frame: PhotoFrame, provider: BrowserPreviewProvider) {
  const url = await provider.getFullPreviewUrl(frame);
  if (!url) throw new Error(`Reconnect ${frame.filename} to export it.`);
  const source = new Image();
  source.src = url;
  await source.decode();
  return source;
}

export async function renderExport(source: HTMLImageElement, frame: PhotoFrame, profile: ExportProfile, date: Date, signal?: AbortSignal) {
  const framing = frame.framing ?? DEFAULT_FRAMING;
  const { width, height } = framedSize(source.naturalWidth, source.naturalHeight, framing);
  const scale = exportScale(width, height, profile);
  const mime = profile.format === 'png' ? 'image/png' : 'image/jpeg';
  const canvas = document.createElement('canvas');
  try {
    drawFramedPhoto(source, canvas, framing, { scale });
    await applyCanvasExportEdit(canvas, frame.edit ?? DEFAULT_EDIT, signal);
    signal?.throwIfAborted();
    const raw = !frame.isDemo && /\.(nef|nrw)$/i.test(frame.filename);
    const name = exportFilename(frame.filename, profile, raw);
    for (const quality of profile.maxBytes ? [profile.quality, ...[0.88, 0.82, 0.74, 0.65].filter((value) => value < profile.quality)] : [profile.quality]) {
      const encoded = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));
      if (!encoded || encoded.type !== mime) throw new Error(`Could not encode ${name} at ${canvas.width} × ${canvas.height} px.`);
      const file = datedExport(encoded, name, date);
      if (!profile.maxBytes || file.size <= profile.maxBytes) return file;
    }
    throw new Error(`${name} is above the preset’s file-size limit. Choose smaller export dimensions.`);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
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

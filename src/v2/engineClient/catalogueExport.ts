// "Leave whenever you like": everything InFlight knows about a project's photos, in open formats, in one ZIP.
//  - xmp/<name>.xmp: rating, pick or reject, keywords, and the basic edit as Camera Raw settings (crs:), which Lightroom,
//    Camera Raw and other XMP-aware editors read when the sidecar sits beside the original.
//  - catalogue.csv: one row per photo, for any spreadsheet.
//  - recipes.json: InFlight's own full edit recipes, lossless, as plain JSON.
//  - README.txt: what each file is, and what is an approximation.
// Never includes photo pixels or originals, and nothing is uploaded: the ZIP is built and saved on this device.
import { zipSync } from 'fflate';
import { isEmptyEdit } from '../../core/photoEdits';
import { cameraRawSettings, sidecarWithEdit } from './cameraRawMap';
import type { CullingState, PhotoFrame } from '../../core/types';
import { xmpScope } from './xmpOps';

export { cameraRawSettings, sidecarWithEdit };

const csvCell = (value: unknown) => {
  const text = value == null ? '' : String(value);
  // A leading = + - @ would run as a formula in a spreadsheet; a quote mark keeps it as text.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const DECISION = { keep: 'flagged', reject: 'set aside', unreviewed: 'unreviewed' } as const;

export interface CatalogueExport { name: string; blob: Blob; photos: number; edited: number }

export function buildCatalogueExport(state: CullingState, exportedAt: Date): CatalogueExport | null {
  const frames = state.frames.filter((frame) => frame.removedAt == null && !frame.isDemo);
  if (!frames.length) return null;
  const files: Record<string, Uint8Array> = {};
  const encode = (text: string) => new TextEncoder().encode(text);

  // One sidecar per original; a paired JPEG shares its RAW's sidecar, as on the File menu.
  const used = new Set<string>();
  let clashes = 0;
  for (const frame of xmpScope(frames, [])) {
    const sidecar = sidecarWithEdit(frame);
    const key = sidecar.filename.normalize('NFC').toLowerCase();
    const path = used.has(key) ? `xmp-same-name/${++clashes}-${sidecar.filename}` : `xmp/${sidecar.filename}`;
    used.add(key);
    files[path] = sidecar.bytes;
  }

  const header = ['file', 'original path', 'decision', 'rating', 'keywords', 'captured', 'camera', 'lens', 'edited', 'virtual copy'];
  const rows = frames.map((frame) => [
    frame.filename, frame.sourcePath ?? '', DECISION[frame.decision], frame.rating ?? '',
    (frame.tags ?? []).filter((tag) => !(frame.autoTags ?? []).includes(tag)).join('; '),
    frame.exif?.capturedAtMs ? new Date(frame.exif.capturedAtMs).toISOString() : '',
    frame.exif?.camera ?? '', frame.exif?.lens ?? '',
    frame.edit && !isEmptyEdit(frame.edit) ? 'yes' : 'no', frame.virtualCopy ? frame.virtualCopy.number : '',
  ]);
  files['catalogue.csv'] = encode('﻿' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n');

  const recipes = {
    format: 'inflight-recipes', version: 1, project: state.shoot.title, exportedAt: exportedAt.toISOString(),
    photos: frames.map((frame) => ({
      file: frame.filename,
      ...(frame.sourcePath ? { originalPath: frame.sourcePath } : {}),
      ...(frame.originalSha256 ? { originalSha256: frame.originalSha256 } : {}),
      decision: frame.decision, rating: frame.rating ?? 0,
      keywords: (frame.tags ?? []).filter((tag) => !(frame.autoTags ?? []).includes(tag)),
      ...(frame.virtualCopy ? { virtualCopy: frame.virtualCopy.number } : {}),
      ...(frame.edit ? { edit: frame.edit } : {}),
      ...(frame.framing ? { framing: frame.framing } : {}),
      ...(frame.sizeCrops ? { crops: frame.sizeCrops } : {}),
    })),
  };
  files['recipes.json'] = encode(JSON.stringify(recipes, null, 2));
  files['README.txt'] = encode(README(state.shoot.title, exportedAt, frames.length));

  const edited = frames.filter((frame) => frame.edit && !isEmptyEdit(frame.edit)).length;
  const stem = state.shoot.title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 60) || 'project';
  return {
    name: `${stem} - InFlight export.zip`,
    blob: new Blob([new Uint8Array(zipSync(files, { level: 6 }))], { type: 'application/zip' }),
    photos: frames.length, edited,
  };
}

const README = (title: string, at: Date, photos: number) => `InFlight export of "${title}", ${photos} photos, made ${at.toISOString()}.
Nothing here contains your photos' pixels; your originals were never changed.

xmp/            One sidecar per original, named like it (DSC_0001.NEF -> DSC_0001.xmp). Put each beside its original and
                Lightroom, Camera Raw, darktable and other XMP-aware apps read the star rating, pick or reject, keywords
                and the basic edit (exposure, contrast, highlights, shadows, whites, blacks, clarity, texture, dehaze,
                vibrance, saturation, noise reduction, vignette, grain). The edit numbers carry over one to one, but each
                app renders them its own way, so the look is close, not identical. Crops, curves, colour mixer, masks and
                white balance are not in the sidecars; they are in recipes.json.
xmp-same-name/  Only if two photos would have the same sidecar name (for example a virtual copy). Rename before use.
catalogue.csv   One row per photo: file, original path, decision, rating, keywords, capture time, camera, lens.
recipes.json    InFlight's complete edit recipes, as plain JSON, so nothing you did is lost.
`;

/** Build and save the export on this device: a save dialog on the desktop, a share sheet on phones, a download in a browser. */
export async function saveCatalogueExport(state: CullingState): Promise<'saved' | 'cancelled' | 'nothing' | 'failed'> {
  const output = buildCatalogueExport(state, new Date());
  if (!output) return 'nothing';
  const { isDesktopApp, isMobileShell, saveWithDialog } = await import('../../providers/desktopShell');
  const { downloadInBrowser } = await import('../../providers/browserExport');
  try {
    if (isMobileShell()) {
      const shared = { files: [new File([output.blob], output.name, { type: output.blob.type })] };
      if (navigator.canShare?.(shared)) await navigator.share(shared);
      else downloadInBrowser(output.blob, output.name);
    } else if (isDesktopApp()) {
      if (!await saveWithDialog(output.blob, output.name, true)) return 'cancelled';
    } else {
      downloadInBrowser(output.blob, output.name);
    }
  } catch (reason) {
    if (reason instanceof Error && reason.name === 'AbortError') return 'cancelled';
    return 'failed';
  }
  return 'saved';
}

import type { PanoRefusal, PanoSource, PanoSuccess, PanoWarning } from '../../core/panorama';
import { MAX_PANO_FRAMES, MIN_PANO_FRAMES } from '../../core/panorama';
import { fullResolutionRasterFormat, isHeifFile, isRawPreviewFile } from '../../core/rawFormats';
import type { PhotoFrame } from '../../core/types';
import { panoText } from '../../i18n/areas/pano';

/**
 * Panorama stitching in V2: everything between the editor's chosen photos and the pure stitcher (src/core/panorama.ts).
 * The result is a NEW photo (a lossless 16-bit PNG added to the project like an import) that carries a recipe of its
 * sources; the originals are only ever read.
 */

/** This device's own preview switch (Settings has none yet): `localStorage['kestrel.preview.panorama.v1'] = '1'`. */
export const PANORAMA_PREVIEW_KEY = 'kestrel.preview.panorama.v1';

export function panoramaPreviewOn(storage: Pick<Storage, 'getItem'> | null | undefined = typeof localStorage === 'undefined' ? null : localStorage): boolean {
  try { return storage?.getItem(PANORAMA_PREVIEW_KEY) === '1'; } catch { return false; }
}

/** The chosen frames in shooting order (neighbours are matched to each other), or why they cannot be stitched. */
export function panoSelection(frames: readonly PhotoFrame[], photoIds: readonly string[]):
  { ok: true; frames: PhotoFrame[] } | { ok: false; message: string } {
  const chosen = new Set(photoIds);
  const picked = frames.filter((frame) => chosen.has(frame.id) && frame.removedAt == null && !frame.isDemo)
    .sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  if (picked.length < MIN_PANO_FRAMES) return { ok: false, message: panoText.tooFew };
  if (picked.length > MAX_PANO_FRAMES) return { ok: false, message: panoText.tooMany(MAX_PANO_FRAMES) };
  for (const frame of picked) {
    if (isHeifFile(frame.filename) || (!fullResolutionRasterFormat(frame.filename) && !isRawPreviewFile(frame.filename))) {
      return { ok: false, message: panoText.unsupported(frame.filename) };
    }
  }
  return { ok: true, frames: picked };
}

/** `coast_0012.jpg` + 4 frames → `coast_0012-pano4.png`. Never the name of a source. */
export function panoFilename(first: string, count: number, taken: ReadonlySet<string> = new Set()): string {
  const base = first.replace(/\.[^.]+$/, '') || 'photo';
  let name = `${base}-pano${count}.png`;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base}-pano${count}-${i}.png`;
  return name;
}

export function panoRefusalText(refusal: PanoRefusal): string {
  const n = refusal.frameNumber ?? 1;
  switch (refusal.reason) {
    case 'too-few': return panoText.tooFew;
    case 'too-many': return panoText.tooMany(MAX_PANO_FRAMES);
    case 'size-mismatch': return panoText.sizeMismatch;
    case 'too-flat': return panoText.tooFlat(n);
    case 'unrelated': return panoText.unrelated(n);
    case 'ambiguous': return panoText.ambiguous(n);
    case 'vertical': return panoText.vertical;
    case 'too-large': return panoText.tooLarge;
    case 'no-coverage': return panoText.noCoverage;
  }
}

export function panoWarningText(warning: PanoWarning): string | null {
  switch (warning.code) {
    case 'exposure-differs': return panoText.exposureDiffers;
    case 'seams-visible': return panoText.seamsVisible;
    case 'focal-estimated': return panoText.focalEstimated;
    case 'large-crop': return null; // the crop note already says how much was kept
  }
}

/** One notice for a finished panorama: what was added, how much the honest crop kept, then at most two calm warnings. */
export function panoDoneNotice(name: string, result: Pick<PanoSuccess, 'warnings' | 'crop'>, count: number): string {
  const kept = Math.round((100 * result.crop.width * result.crop.height) / (result.crop.fullWidth * result.crop.fullHeight));
  const seen = new Set<string>();
  const extra = result.warnings.filter((w) => w.code !== 'focal-estimated')
    .map(panoWarningText).filter((text): text is string => !!text && !seen.has(text) && !!seen.add(text)).slice(0, 2);
  return [panoText.done(name, count), panoText.cropNote(Math.min(100, Math.max(1, kept))), ...extra].join(' ');
}

/** A decoded picture's full-size RGBA through one canvas (the stitcher needs every frame at once). */
export function imagePanoSource(image: CanvasImageSource & { naturalWidth: number; naturalHeight: number }): PanoSource {
  const width = image.naturalWidth, height = image.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, width, height).data;
  canvas.width = 0; canvas.height = 0;
  return { width, height, data, bits: 8 };
}

import type { HdrRefusal, HdrSuccess, HdrWarning } from '../../core/hdrMerge';
import { MAX_HDR_FRAMES, MIN_HDR_FRAMES } from '../../core/hdrMerge';
import { fullResolutionRasterFormat, isHeifFile, isRawPreviewFile } from '../../core/rawFormats';
import type { PhotoFrame } from '../../core/types';
import { hdrText } from '../../i18n/areas/hdr';
import { previewKey, previewOn } from '../../core/previewFeatures';

/**
 * HDR merge in V2: everything between the editor's chosen photos and the pure merge (src/core/hdrMerge.ts). The result
 * is a NEW photo (a lossless 16-bit PNG added to the project like an import) that carries a recipe of its bracket; the
 * originals are only ever read.
 */

/** This device's own preview switch (Settings → Preview features); the registry is src/core/previewFeatures.ts. */
export const HDR_PREVIEW_KEY = previewKey('hdrMerge');

export function hdrPreviewOn(storage: Pick<Storage, 'getItem'> | null | undefined = typeof localStorage === 'undefined' ? null : localStorage): boolean {
  return previewOn('hdrMerge', storage);
}

/** The chosen frames in shooting order, or why they cannot be merged. */
export function hdrSelection(frames: readonly PhotoFrame[], photoIds: readonly string[]):
  { ok: true; frames: PhotoFrame[] } | { ok: false; message: string } {
  const chosen = new Set(photoIds);
  const picked = frames.filter((frame) => chosen.has(frame.id) && frame.removedAt == null && !frame.isDemo)
    .sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  if (picked.length < MIN_HDR_FRAMES) return { ok: false, message: hdrText.tooFew };
  if (picked.length > MAX_HDR_FRAMES) return { ok: false, message: hdrText.tooMany(MAX_HDR_FRAMES) };
  for (const frame of picked) {
    if (isHeifFile(frame.filename) || (!fullResolutionRasterFormat(frame.filename) && !isRawPreviewFile(frame.filename))) {
      return { ok: false, message: hdrText.unsupported(frame.filename) };
    }
  }
  return { ok: true, frames: picked };
}

/** `dawn_0031.jpg` + 3 frames → `dawn_0031-hdr3.png`. Never the name of a source. */
export function hdrFilename(first: string, count: number, taken: ReadonlySet<string> = new Set()): string {
  const base = first.replace(/\.[^.]+$/, '') || 'photo';
  let name = `${base}-hdr${count}.png`;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base}-hdr${count}-${i}.png`;
  return name;
}

export function hdrRefusalText(refusal: HdrRefusal): string {
  const n = refusal.frameNumber ?? 1;
  switch (refusal.reason) {
    case 'too-few': return hdrText.tooFew;
    case 'too-many': return hdrText.tooMany(MAX_HDR_FRAMES);
    case 'size-mismatch': return hdrText.sizeMismatch;
    case 'same-exposure': return hdrText.sameExposure;
    case 'unrelated': return hdrText.unrelated(n);
  }
}

function warningText(warning: HdrWarning): string | null {
  switch (warning.code) {
    case 'ghosts-removed': return hdrText.ghostsRemoved;
    case 'highlights-clipped': return hdrText.highlightsClipped;
    default: return null;
  }
}

/** One notice for a finished merge: what was added, then at most two calm warnings (each said once). */
export function hdrDoneNotice(name: string, result: Pick<HdrSuccess, 'warnings'>, count: number): string {
  const extra = [...new Set(result.warnings.map(warningText).filter((t): t is string => !!t))].slice(0, 2);
  return [hdrText.done(name, count), ...extra].join(' ');
}

/** "+1.3", "0", "-2" — stops for the Info panel. */
export function stopsLabel(ev: number): string {
  const v = Math.round(ev * 10) / 10;
  return v === 0 ? '0' : `${v > 0 ? '+' : '−'}${Math.abs(v)}`;
}

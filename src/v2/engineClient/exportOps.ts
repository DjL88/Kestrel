import { applyFormats } from './formatOps';
import type { ExportFormat } from '../../core/exportFormats';
import { readCrops, DEFAULT_CROP } from './cropOps';
import type { CropTransform, ExportRequest, SizePreset } from '../ui/contract';

export interface ExportFrameInfo { id: string; filename: string; removedAt?: number; sizeCrops?: unknown; formats?: unknown }
/** 'edited' is the photo with its recipe (and overlay if asked). 'unedited' is the same framing with no edit at all, developed to JPEG: it is not the original file. */
export type ExportVariant = 'edited' | 'unedited';
export interface ExportJob { frameId: string; format: ExportFormat; size: { width: number; height: number }; crop: CropTransform; variants: ExportVariant[] }
/** `originals` are photos whose exact original bytes are to be copied, never a developed or preview file. */
export type ExportPlan = { jobs: ExportJob[]; originals: string[]; summary: string } | { error: string };

const SAFE_PREFIX = /[\\/:*?"<>|\u0000-\u001f]/g;
const DESTINATIONS = ['local-zip', 'local-individual'] as const;

/**
 * Turns a V2 export request into one render job per photo and size, or says plainly what cannot be exported yet.
 * Anything the exported file would not honour is refused rather than dropped, so the file always matches what was asked for.
 * Each job carries the size copy's own crop. A size never enlarges the photo: the renderer caps each output at the source's real pixels.
 */
export function planExport(request: ExportRequest, frames: readonly ExportFrameInfo[], sizes: readonly SizePreset[]): ExportPlan {
  if (!DESTINATIONS.includes(request.destination as (typeof DESTINATIONS)[number])) return { error: 'That destination is not connected yet. Choose Download as a zip or Download each file.' };
  if (request.includeVideo) return { error: 'Zoom video export is not connected yet.' };
  const variants: ExportVariant[] = [...(request.includeBefore ? ['unedited' as const] : []), ...(request.includeAfter ? ['edited' as const] : [])];
  if (!variants.length && !request.includeOriginal) return { error: 'Choose what to export: the edited photo, the unedited photo, or the original file.' };

  const chosen = frames.filter((frame) => request.photoIds.includes(frame.id) && !frame.removedAt);
  if (!chosen.length) return { error: 'Choose at least one photo to export.' };
  const allSizes = chosen.flatMap((frame) => applyFormats(sizes, frame.formats));
  const picked = [...new Map(allSizes.filter((size) => size.kind === 'photo' && request.sizeIds.includes(size.id)).map((size) => [size.id, size])).values()];
  if (variants.length && !picked.length) return { error: 'Choose at least one size to export.' };

  const jobs: ExportJob[] = [];
  for (const frame of variants.length ? chosen : []) {
    const crops = readCrops(frame.sizeCrops);
    // A photo exports the formats it has: its own custom formats exist only on it, and one it has switched off is skipped.
    const own = new Map(applyFormats(sizes, frame.formats).map((size) => [size.id, size]));
    for (const size of picked.filter((entry) => own.get(entry.id)?.enabled === true)) {
      if (!Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width < 1 || size.height < 1) return { error: `${size.label} has no usable size.` };
      jobs.push({ frameId: frame.id, variants, size: { width: size.width, height: size.height }, crop: crops[size.id] ?? { ...DEFAULT_CROP }, format: {
        id: size.id, label: size.label, width: size.width, height: size.height, fit: 'fill', quality: 0.94, format: 'jpeg',
        prefix: `${size.id.replace(SAFE_PREFIX, '_').slice(0, 24)}_`,
      } });
    }
  }
  const originals = request.includeOriginal ? chosen.map((frame) => frame.id) : [];
  const files = jobs.length * variants.length + originals.length;
  const parts = [variants.length ? `${chosen.length} photo${chosen.length === 1 ? '' : 's'} × ${picked.length} size${picked.length === 1 ? '' : 's'}${variants.length > 1 ? ' × before and after' : request.includeBefore ? ' (unedited)' : ''}` : '', originals.length ? `${originals.length} original file${originals.length === 1 ? '' : 's'}` : ''].filter(Boolean);
  return { jobs, originals, summary: `${parts.join(' + ')} = ${files} file${files === 1 ? '' : 's'}` };
}

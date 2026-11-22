import type { ExportFormat } from '../../core/exportFormats';
import { readCrops, DEFAULT_CROP } from './cropOps';
import type { CropTransform, ExportRequest, SizePreset } from '../ui/contract';

export interface ExportFrameInfo { id: string; filename: string; removedAt?: number; sizeCrops?: unknown }
export interface ExportJob { frameId: string; format: ExportFormat; size: { width: number; height: number }; crop: CropTransform }
export type ExportPlan = { jobs: ExportJob[]; summary: string } | { error: string };

const SAFE_PREFIX = /[\\/:*?"<>|\u0000-\u001f]/g;
const DESTINATIONS = ['local-zip', 'local-individual'] as const;

/**
 * Turns a V2 export request into one render job per photo and size, or says plainly what cannot be exported yet.
 * Anything the exported file would not honour is refused rather than dropped, so the file always matches what was asked for.
 * Each job carries the size copy's own crop. A size never enlarges the photo: the renderer caps each output at the source's real pixels.
 */
export function planExport(request: ExportRequest, frames: readonly ExportFrameInfo[], sizes: readonly SizePreset[]): ExportPlan {
  if (!DESTINATIONS.includes(request.destination as (typeof DESTINATIONS)[number])) return { error: 'That destination is not connected yet. Choose Download as a zip or Download each file.' };
  if (request.includeBefore) return { error: 'Before images are not in exported files yet. Untick Before to export the edited photos.' };
  if (request.includeVideo) return { error: 'Zoom video export is not connected yet.' };
  if (!request.includeAfter) return { error: 'Choose what to export: the edited photo.' };

  const chosen = frames.filter((frame) => request.photoIds.includes(frame.id) && !frame.removedAt);
  if (!chosen.length) return { error: 'Choose at least one photo to export.' };
  const picked = sizes.filter((size) => size.kind === 'photo' && request.sizeIds.includes(size.id));
  if (!picked.length) return { error: 'Choose at least one size to export.' };

  const jobs: ExportJob[] = [];
  for (const frame of chosen) {
    const crops = readCrops(frame.sizeCrops);
    for (const size of picked) {
      if (!Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width < 1 || size.height < 1) return { error: `${size.label} has no usable size.` };
      jobs.push({ frameId: frame.id, size: { width: size.width, height: size.height }, crop: crops[size.id] ?? { ...DEFAULT_CROP }, format: {
        id: size.id, label: size.label, width: size.width, height: size.height, fit: 'fill', quality: 0.94, format: 'jpeg',
        prefix: `${size.id.replace(SAFE_PREFIX, '_').slice(0, 24)}_`,
      } });
    }
  }
  const files = jobs.length;
  return { jobs, summary: `${chosen.length} photo${chosen.length === 1 ? '' : 's'} × ${picked.length} size${picked.length === 1 ? '' : 's'} = ${files} file${files === 1 ? '' : 's'}` };
}

import { applyFormats } from './formatOps';
import { isFormatSplit, formatSplitOffset } from './formatSplitOps';
import type { ExportFormat } from '../../core/exportFormats';
import { readCrops, DEFAULT_CROP } from './cropOps';
import { framedSize, DEFAULT_FRAMING, type PhotoFraming } from '../../core/photoFraming';
import type { CropTransform, ExportRequest, SizePreset } from '../ui/contract';

export interface ExportFrameInfo { id: string; filename: string; removedAt?: number; sizeCrops?: unknown; formats?: unknown; formatSplits?: unknown; splitFrames?: unknown; splitPanOffset?: unknown; exif?: { width?: number; height?: number }; framing?: PhotoFraming }
/** 'edited' is the photo with its recipe (and overlay if asked). 'unedited' is the same framing with no edit at all, developed to JPEG: it is not the original file. */
export type ExportVariant = 'edited' | 'unedited';
export interface ExportJob { frameId: string; format: ExportFormat; size: { width: number; height: number }; crop: CropTransform; variants: ExportVariant[]; /** One source image spread over two adjoining output canvases. */ sections?: 2 }
/** `originals` are photos whose exact original bytes are to be copied, never a developed or preview file. */
export type ExportPlan = { jobs: ExportJob[]; originals: string[]; summary: string } | { error: string };

const SAFE_PREFIX = /[\\/:*?"<>|\u0000-\u001f]/g;
const DESTINATIONS = ['local-zip', 'local-individual'] as const;

/** Shrinks width/height so the longer side is at most `maxEdge`, keeping the aspect ratio. Never upscales: a size
 * already at or under the cap is returned unchanged. `maxEdge` of 0, undefined or non-finite means no cap. */
function capLongestEdge(size: { width: number; height: number }, maxEdge: number | undefined): { width: number; height: number } {
  if (!maxEdge || !Number.isFinite(maxEdge) || maxEdge <= 0) return size;
  const longest = Math.max(size.width, size.height);
  if (longest <= maxEdge) return size;
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) };
}

/** A recorded shape, never proof that an embedded JPEG has full RAW sensor pixels. */
function importedDimensions(frame: ExportFrameInfo): { width: number; height: number } | null {
  const width = frame.exif?.width, height = frame.exif?.height;
  if (!width || !height || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
      || width <= 0 || height <= 0) return null;
  return framedSize(width, height, frame.framing ?? DEFAULT_FRAMING);
}

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

  // A removedAt value of 0 is still a removed photograph, not a live one.
  const chosen = frames.filter((frame) => request.photoIds.includes(frame.id) && frame.removedAt == null);
  if (!chosen.length) return { error: 'Choose at least one photo to export.' };
  // Export jobs carry frame IDs, not immutable byte references. If two live
  // catalogue entries share an ID, resolving it later could select the wrong
  // photo (including when the user requested exact original bytes).
  if (new Set(chosen.map((frame) => frame.id)).size !== chosen.length) {
    return { error: 'Two selected photos have the same identity. Resolve the duplicate before exporting.' };
  }
  const allSizes = chosen.flatMap((frame) => applyFormats(sizes, frame.formats, importedDimensions(frame)));
  const picked = [...new Map(allSizes.filter((size) => size.kind === 'photo' && request.sizeIds.includes(size.id)).map((size) => [size.id, size])).values()];
  if (variants.length && !picked.length) return { error: 'Choose at least one size to export.' };

  const format = request.fileFormat ?? 'jpeg';
  const quality = format === 'jpeg' ? request.jpegQuality ?? 0.94 : 1;
  if (variants.length && (format !== 'jpeg' && format !== 'png')) return { error: 'Choose JPEG or PNG.' };
  if (variants.length && (!Number.isFinite(quality) || quality < 0 || quality > 1)) return { error: 'Choose a JPEG quality from 0 to 100%.' };
  const maxEdge = request.maxLongestEdgePx;
  if (maxEdge !== undefined && (!Number.isFinite(maxEdge) || maxEdge < 0)) return { error: 'Choose a valid maximum size, or leave it at full size.' };
  const jobs: ExportJob[] = [];
  for (const frame of variants.length ? chosen : []) {
    const crops = readCrops(frame.sizeCrops);
    // A photo exports the formats it has: its own custom formats exist only on it, and one it has switched off is skipped.
    const own = new Map(applyFormats(sizes, frame.formats).map((size) => [size.id, size]));
    for (const selected of picked) {
      // Identical format IDs may be saved with different dimensions on each photo.
      // Resolve from this photo, never use the last matching size from another frame.
      const size = own.get(selected.id);
      if (!size?.enabled) continue;
      if (!Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width < 1 || size.height < 1) return { error: `${size.label} has no usable size.` };
      const splitState = frame.formatSplits ?? (frame.splitFrames === true ? { 'orig-3x2': { enabled: true, offset: frame.splitPanOffset ?? 0 } } : undefined);
      const sections = isFormatSplit(splitState, size.id) ? 2 : 1;
      // The cap applies to the COMPLETE composition, not each panel in isolation.
      // Otherwise two 1080px panels could defeat a 1200px export limit.
      const combined = capLongestEdge({ width: size.width * sections, height: size.height }, maxEdge);
      if (size.width * sections > 20000 || combined.width < sections) {
        return { error: `${size.label} split is too wide for a safe export at these dimensions. Choose a smaller format or a larger output limit.` };
      }
      const capped = { width: Math.floor(combined.width / sections), height: combined.height };
      const crop = crops[size.id] ?? { ...DEFAULT_CROP };
      const offset = formatSplitOffset(splitState, size.id);
      const movedCrop = offset === 0 ? crop : { ...crop, panX: Math.max(-50, Math.min(50, crop.panX + offset)) };
      jobs.push({ frameId: frame.id, variants, size: capped, crop: movedCrop, ...(sections === 2 ? { sections: 2 as const } : {}), format: {
        id: size.id, label: size.label, width: capped.width, height: capped.height, fit: 'fill', quality, format,
        prefix: `${size.id.replace(SAFE_PREFIX, '_').slice(0, 24)}_`,
      } });
    }
  }
  const originals = request.includeOriginal ? chosen.map((frame) => frame.id) : [];
  if (variants.length && !jobs.length && !originals.length) return { error: 'None of the selected sizes is enabled on the chosen photos.' };
  const files = jobs.reduce((sum, job) => sum + (job.sections ?? 1) * job.variants.length, 0) + originals.length;
  const completeGrid = jobs.length === chosen.length * picked.length;
  const developed = !jobs.length ? '' : completeGrid
    ? `${chosen.length} photo${chosen.length === 1 ? '' : 's'} × ${picked.length} size${picked.length === 1 ? '' : 's'}${variants.length > 1 ? ' × before and after' : request.includeBefore ? ' (unedited)' : ''}`
    : `${jobs.length} size version${jobs.length === 1 ? '' : 's'} across ${chosen.length} photo${chosen.length === 1 ? '' : 's'}${variants.length > 1 ? ' × before and after' : request.includeBefore ? ' (unedited)' : ''}`;
  const parts = [developed, originals.length ? `${originals.length} original file${originals.length === 1 ? '' : 's'}` : ''].filter(Boolean);
  const splitJobs = jobs.filter((job) => job.sections === 2).length;
  return { jobs, originals, summary: `${parts.join(' + ')}${splitJobs ? ` (${splitJobs} split format${splitJobs === 1 ? '' : 's'})` : ''} = ${files} file${files === 1 ? '' : 's'}` };
}

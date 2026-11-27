import { exportCrop } from './frameGeometry';
import { readEditGroups } from './editGroupState';
import type { PhotoFrame } from '../../core/types';
import { DEFAULT_EDIT, type PhotoEdit } from '../../core/photoEdits';
import { applyFormats } from './formatOps';
import { fullResolutionRasterFormat } from '../../core/rawFormats';
import { splitFrameCount, formatSplitOffset } from './formatSplitOps';
import type { ExportFormat } from '../../core/exportFormats';
import { readCrops, DEFAULT_CROP } from './cropOps';
import { framedSize, DEFAULT_FRAMING, type PhotoFraming } from '../../core/photoFraming';
import type { CropTransform, ExportRequest, SizePreset } from '../ui/contract';
import { effectiveOutputSize } from '../ui/utils/studioMath';

export interface ExportFrameInfo extends Pick<PhotoFrame, 'edit' | 'v2EditGroups'> { id: string; filename: string; isDemo?: boolean; removedAt?: number; sizeCrops?: unknown; formats?: unknown; formatSplits?: unknown; splitFrames?: unknown; splitPanOffset?: unknown; exif?: { width?: number; height?: number }; framing?: PhotoFraming }
/** 'edited' is the photo with its recipe (and overlay if asked). 'unedited' is the same framing with no edit at all, developed to JPEG: it is not the original file. */
export interface ExportVariant { kind: 'edited' | 'unedited'; edit: PhotoEdit; suffix: string }
export interface ExportJob { frameId: string; format: ExportFormat; size: { width: number; height: number }; crop: CropTransform; variants: ExportVariant[]; /** One source image spread over two adjoining output canvases. */ sections?: 2 | 3 | 4 | 5 }
/** `originals` are photos whose exact original bytes are to be copied, never a developed or preview file. */
export type ExportPlan = { jobs: ExportJob[]; originals: string[]; summary: string } | { error: string };

const SAFE_PREFIX = /[\\/:*?"<>|\u0000-\u001f]/g;
const DESTINATIONS = ['local-zip', 'local-individual', 'local-folder'] as const;

/** Shrinks width/height so the longer side is at most `maxEdge`, keeping the aspect ratio. Never upscales: a size
 * already at or under the cap is returned unchanged. `maxEdge` of 0, undefined or non-finite means no cap. */
function capLongestEdge(size: { width: number; height: number }, maxEdge: number | undefined): { width: number; height: number } {
  if (!maxEdge || !Number.isFinite(maxEdge) || maxEdge <= 0) return size;
  const longest = Math.max(size.width, size.height);
  if (longest <= maxEdge) return size;
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) };
}

/**
 * The pixel size an Original export asks for: the picture's own size times the edit's Output scale (2× doubles it), then
 * held under the person's longest-edge limit across the whole (possibly split) composition. The renderer still enlarges
 * only when the device can hold the result; otherwise it exports at the picture's own size and reports the cap.
 */
export function originalExportSize(
  base: { width: number; height: number }, factor: 1 | 2 | 4 | undefined, sections: number, maxEdge: number | undefined,
): { width: number; height: number } {
  const f = factor === 2 || factor === 4 ? factor : 1;
  const width = base.width * f, height = base.height * f;
  const longest = Math.max(width * Math.max(1, sections), height);
  const scale = maxEdge && Number.isFinite(maxEdge) && maxEdge > 0 ? Math.min(1, maxEdge / longest) : 1;
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

/**
 * Whether an Original export came out at the size it promised. Original is the photo's own pixels: it may be smaller
 * only by the person's own crop of the Original format (its zoom and insets), and then it says so. Smaller than that
 * means the picture it was drawn from was not the full-resolution develop: the export must stop, never deliver a
 * smaller file silently (owner's test: 'Original 4000 x 2672' delivered at 2723 x 1819).
 */
export function originalExportCheck(
  requested: { width: number; height: number }, crop: Pick<CropTransform, 'zoom' | 'insetTop' | 'insetRight' | 'insetBottom' | 'insetLeft'>,
  produced: { width: number; height: number },
): { kind: 'full' } | { kind: 'cropped'; expected: { width: number; height: number } } | { kind: 'short'; expected: { width: number; height: number } } {
  const expected = effectiveOutputSize({ ...requested, crop }, requested);
  // One pixel of rounding either way is the same size.
  const fits = (got: number, want: number) => got >= want - 1;
  if (!fits(produced.width, expected.width) || !fits(produced.height, expected.height)) return { kind: 'short', expected: { width: expected.width, height: expected.height } };
  return expected.capped ? { kind: 'cropped', expected: { width: expected.width, height: expected.height } } : { kind: 'full' };
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
  const developedRequested = request.includeAfter || request.includeBefore;
  if (!developedRequested && !request.includeOriginal) return { error: 'Choose what to export: the edited photo, the unedited photo, or the original file.' };

  // A removedAt value of 0 is still a removed photograph, not a live one.
  const chosen = frames.filter((frame) => request.photoIds.includes(frame.id) && frame.removedAt == null);
  if (!chosen.length) return { error: 'Choose at least one photo to export.' };
  // Export jobs carry frame IDs, not immutable byte references. If two live
  // catalogue entries share an ID, resolving it later could select the wrong
  // photo (including when the user requested exact original bytes).
  if (new Set(chosen.map((frame) => frame.id)).size !== chosen.length) {
    return { error: 'Two selected photos have the same identity. Resolve the duplicate before exporting.' };
  }
  // Original JPEG/PNG jobs can resolve their dimensions from verified pixels at render time.
  const pendingRasterSize = { width: 1, height: 1 };
  const sizesFor = (frame: ExportFrameInfo) => applyFormats(sizes, frame.formats, importedDimensions(frame) ??
    (!frame.isDemo && fullResolutionRasterFormat(frame.filename) ? pendingRasterSize : null));
  const allSizes = chosen.flatMap(sizesFor);
  const picked = [...new Map(allSizes.filter((size) => size.kind === 'photo' && request.sizeIds.includes(size.id)).map((size) => [size.id, size])).values()];
  if (developedRequested && !picked.length) return { error: 'Choose at least one size to export.' };

  const format = request.fileFormat ?? 'jpeg';
  const quality = format === 'jpeg' ? request.jpegQuality ?? 0.94 : 1;
  if (developedRequested && (format !== 'jpeg' && format !== 'png')) return { error: 'Choose JPEG or PNG.' };
  if (developedRequested && (!Number.isFinite(quality) || quality < 0 || quality > 1)) return { error: 'Choose a JPEG quality from 0 to 100%.' };
  const maxEdge = request.maxLongestEdgePx;
  if (maxEdge !== undefined && (!Number.isFinite(maxEdge) || maxEdge < 0)) return { error: 'Choose a valid maximum size, or leave it at full size.' };
  const jobs: ExportJob[] = [];
  for (const frame of developedRequested ? chosen : []) {
    const variants: ExportVariant[] = [];
    if (request.includeBefore) variants.push({ kind: 'unedited', edit: DEFAULT_EDIT, suffix: '-unedited' });
    if (request.includeAfter) {
      const saved = readEditGroups(frame);
      const ids = new Set(request.groupIds.length ? request.groupIds : [saved.activeId]);
      const groups = saved.groups.filter(group => ids.has(group.id));
      if (groups.length !== ids.size) return { error: `A selected edit group is unavailable on ${frame.filename}. Reopen Export and select its current edit.` };
      for (const group of groups) {
        const suffix = groups.length > 1 ? '-' + group.name.replace(SAFE_PREFIX, '_').trim() : '';
        variants.push({ kind: 'edited', edit: group.edit ?? DEFAULT_EDIT, suffix });
      }
    }
    const crops = readCrops(frame.sizeCrops);
    // A photo exports the formats it has: its own custom formats exist only on it, and one it has switched off is skipped.
    const own = new Map(sizesFor(frame).map((size) => [size.id, size]));
    for (const selected of picked) {
      // Identical format IDs may be saved with different dimensions on each photo.
      // Resolve from this photo, never use the last matching size from another frame.
      const size = own.get(selected.id);
      if (!size?.enabled) continue;
      if (!Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width < 1 || size.height < 1) return { error: `${size.label} has no usable size.` };
      const splitState = frame.formatSplits ?? (frame.splitFrames === true ? { 'orig-3x2': { enabled: true, offset: frame.splitPanOffset ?? 0 } } : undefined);
      const sections = splitFrameCount(splitState, size.id);
      // The cap applies to the COMPLETE composition, not each panel in isolation.
      // Otherwise two 1080px panels could defeat a 1200px export limit.
      const combined = capLongestEdge({ width: size.width * sections, height: size.height }, maxEdge);
      if (size.width * sections > 20000 || combined.width < sections) {
        return { error: `${size.label} split is too wide for a safe export at these dimensions. Choose a smaller format or a larger output limit.` };
      }
      const capped = { width: Math.floor(combined.width / sections), height: combined.height };
      const crop = crops[size.id] ?? { ...DEFAULT_CROP };
      const offset = formatSplitOffset(splitState, size.id);
      // The same move the canvas shows (frameGeometry.ts): clamping here exported a far pan somewhere else.
      const movedCrop = exportCrop(crop, offset);
      jobs.push({ frameId: frame.id, variants, size: capped, crop: movedCrop, ...(sections > 1 ? { sections: sections as 2 | 3 | 4 | 5 } : {}), format: {
        id: size.id, label: size.label, width: capped.width, height: capped.height, fit: 'fill', quality, format,
        prefix: `${size.id.replace(SAFE_PREFIX, '_').slice(0, 24)}_`,
      } });
    }
  }
  const originals = request.includeOriginal ? chosen.map((frame) => frame.id) : [];
  if (developedRequested && !jobs.length) return { error: 'None of the selected sizes is enabled on the chosen photos.' };
  const files = jobs.reduce((sum, job) => sum + (job.sections ?? 1) * job.variants.length, 0) + originals.length;
  const completeGrid = jobs.length === chosen.length * picked.length;
  const developed = !jobs.length ? '' : completeGrid
    ? `${chosen.length} photo${chosen.length === 1 ? '' : 's'} × ${picked.length} size${picked.length === 1 ? '' : 's'}${request.includeAfter && request.includeBefore ? ' × before and after' : request.includeBefore ? ' (unedited)' : ''}`
    : `${jobs.length} size version${jobs.length === 1 ? '' : 's'} across ${chosen.length} photo${chosen.length === 1 ? '' : 's'}${request.includeAfter && request.includeBefore ? ' × before and after' : request.includeBefore ? ' (unedited)' : ''}`;
  const groupSummary = request.includeAfter && request.groupIds.length > 1 ? ` (${request.groupIds.length} edit groups)` : '';
  const parts = [developed && developed + groupSummary, originals.length ? `${originals.length} original file${originals.length === 1 ? '' : 's'}` : ''].filter(Boolean);
  const splitJobs = jobs.filter((job) => (job.sections ?? 1) > 1).length;
  return { jobs, originals, summary: `${parts.join(' + ')}${splitJobs ? ` (${splitJobs} split format${splitJobs === 1 ? '' : 's'})` : ''} = ${files} file${files === 1 ? '' : 's'}` };
}

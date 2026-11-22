import { describeHistory } from './historySteps';
import type { PhotoFrame, ShootDescriptor } from '../../core/types';
import { computeCullCounts } from '../../core/cullingEngine';
import type { Photo, Project, TaskInfo, TileState } from '../ui/contract';
import { createDefaultSizes, createEditGroups } from '../ui/stub';
import { editToRecipe } from './recipeMap';
import { readOverlay } from './overlayOps';
import { masksToLayers } from './maskOps';
import { readCrops } from './cropOps';
import type { AutoRun } from './runAuto';
import type { AssistSuggestion, EditRecipe, PhotoHistogram } from '../ui/contract';
import type { Task } from '../../core/taskStore';

/** A transparent pixel, so a photo whose picture is not ready yet shows an empty tile rather than a broken image. */
export const BLANK_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** What Auto found for a photo, and what the person has done with it. */
export interface AssistState { run: AutoRun; applied: boolean; dismissed: boolean }

/** Only the sliders Auto would move, in the UI's units. */
export function recipeDelta(base: Parameters<typeof editToRecipe>[0], proposal: Parameters<typeof editToRecipe>[0]): Partial<EditRecipe> {
  const before = editToRecipe(base), after = editToRecipe(proposal);
  return Object.fromEntries((Object.keys(after) as (keyof EditRecipe)[]).filter((key) => before[key] !== after[key]).map((key) => [key, after[key]])) as Partial<EditRecipe>;
}

export function assistCritiqueFor(assist: AssistState | undefined): Photo['assistCritique'] {
  if (!assist) return { subjectNote: '', colourConfidence: '', kelvinEstimate: '', suggestions: [] };
  const { run } = assist;
  const suggestions: AssistSuggestion[] = run.improved && !assist.dismissed ? [{
    id: 'natural-auto',
    title: 'Natural Auto',
    summary: run.detail.slice(2).join(' ') || run.headline,
    colourReadout: run.plan.species.reason,
    applied: assist.applied,
    recipeDelta: recipeDelta(run.plan.base, run.plan.proposal),
  }] : [];
  return {
    subjectNote: run.headline,
    colourConfidence: [run.detail[1], ...run.plan.measured.colourWarnings].filter(Boolean).join(' '),
    kelvinEstimate: 'Not measured',
    suggestions,
  };
}

export interface FrameUrls { thumb?: string; preview?: string; failed?: boolean }

const NOT_RECORDED = 'Not recorded';

const titleOf = (filename: string) => filename.replace(/\.[^./\\]+$/, '');
const extensionOf = (filename: string) => /\.([^./\\]+)$/.exec(filename)?.[1]?.toUpperCase();

/** The subject name for a photo. A name the app suggested itself is marked as a suggestion; nothing is shown when unknown. */
export function speciesLabelOf(frame: Pick<PhotoFrame, 'subjectNames' | 'tags' | 'autoTags'>): string | undefined {
  const chosen = frame.subjectNames?.[0];
  if (chosen) return chosen;
  const tag = frame.tags?.[0];
  if (!tag) return undefined;
  return frame.autoTags?.includes(tag) ? `${tag} (suggested)` : tag;
}

export function tileStateFor(urls: FrameUrls | undefined): TileState {
  if (urls?.failed) return 'unavailable';
  return urls?.thumb ? 'ready' : 'importing';
}

/**
 * One catalogue photo as the V2 UI's Photo. Only what the catalogue actually holds is filled in: a field the file did
 * not record says "Not recorded" (or is left empty), never an invented value. The edit, size and mask parts start as the
 * UI's neutral defaults; they are connected to the real recipe in a later step.
 */
export interface PhotoExtras { pixelSize?: { width: number; height: number }; assist?: AssistState; watermarkAuto?: 'light-on-dark' | 'dark-on-light'; histogram?: PhotoHistogram }

export function frameToPhoto(frame: PhotoFrame, urls: FrameUrls | undefined, extras: PhotoExtras = {}): Photo {
  const { assist, watermarkAuto, histogram, pixelSize } = extras;
  const { exif } = frame;
  // The UI's sample group carries a made-up look. A real photo starts from its own edit: neutral until the person edits it.
  const crops = readCrops(frame.sizeCrops);
  const groups = createEditGroups(false).map((group) => ({ ...group, name: 'Edit group 1', recipe: editToRecipe(frame.edit), overlay: readOverlay(frame.overlay) }));
  const thumb = urls?.thumb ?? BLANK_IMAGE;
  return {
    id: frame.id,
    filename: frame.filename,
    title: titleOf(frame.filename),
    previewUrl: urls?.preview ?? thumb,
    thumbUrl: thumb,
    state: tileStateFor(urls),
    decision: frame.decision,
    originalConnected: !urls?.failed,
    rating: Math.max(0, Math.min(5, Math.round(frame.rating ?? exif.rating ?? 0))),
    speciesLabel: speciesLabelOf(frame),
    category: frame.subjectKind ?? '',
    sharpnessScore: frame.cullScore ?? 0,
    exif: {
      camera: exif.camera ?? NOT_RECORDED,
      lens: exif.lens ?? NOT_RECORDED,
      aperture: exif.apertureF ? `f/${exif.apertureF}` : NOT_RECORDED,
      shutter: exif.shutterSpeed ?? NOT_RECORDED,
      iso: exif.iso ?? 0,
      focalLength: exif.focalLengthMm ? `${exif.focalLengthMm}mm` : NOT_RECORDED,
      capturedAt: exif.capturedAtMs ? new Date(exif.capturedAtMs).toLocaleString('en-GB') : NOT_RECORDED,
      fileFormat: exif.formatLabel ?? extensionOf(frame.filename) ?? NOT_RECORDED,
      fileSizeMb: 0,
      dimensions: exif.width && exif.height ? `${exif.width} × ${exif.height}` : NOT_RECORDED,
      colourProfile: NOT_RECORDED,
    },
    ...(exif.width && exif.height ? { pixelSize: { width: exif.width, height: exif.height } } : pixelSize ? { pixelSize } : {}),
    activeGroupId: groups[0].id,
    editGroups: groups,
    sizes: createDefaultSizes().map((size) => { const crop = crops[size.id]; return crop ? { ...size, crop } : size; }),
    videoZoom: { enabled: false, focalX: 50, focalY: 50, direction: 'in', durationSec: 6 },
    masks: masksToLayers(frame.edit?.masks),
    ...(describeHistory(frame.editHistory) ? { editHistory: describeHistory(frame.editHistory) } : {}),
    ...(watermarkAuto ? { watermarkAuto } : {}),
    ...(histogram ? { histogram } : {}),
    assistCritique: assistCritiqueFor(assist),
  };
}

export function shootToProject(shoot: ShootDescriptor, frames: readonly PhotoFrame[]): Project {
  const live = frames.filter((frame) => !frame.removedAt);
  return {
    id: shoot.id,
    name: shoot.title,
    updatedAt: new Date(shoot.lastUpdatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    coverUrl: BLANK_IMAGE,
    photoCount: computeCullCounts(live as PhotoFrame[]).all,
    flaggedCount: live.filter((frame) => frame.decision === 'keep').length,
    localCopyStatus: 'offline-ready',
    folderPath: shoot.folderName ?? '',
    archived: Boolean(shoot.archivedAt),
  };
}

export function taskToInfo(task: Task): TaskInfo {
  const progress = task.state === 'done' ? 100 : task.total ? Math.min(100, Math.round((task.done / task.total) * 100)) : 0;
  return {
    id: String(task.id),
    label: task.title,
    detail: task.detail ?? (task.total ? `${task.done} of ${task.total}` : ''),
    progress,
    status: task.state === 'running' ? 'running' : task.state,
    ...(task.endedAt !== undefined ? { endedAt: task.endedAt } : {}),
  };
}

/** Finished tasks stay in the Completed tab for this long, or until the person deletes them. */
export const COMPLETED_KEEP_MS = 4 * 60 * 60 * 1000;

/** Running tasks first, then finished ones still inside the keep window, newest first. */
export function visibleTasks(running: readonly TaskInfo[], history: readonly TaskInfo[], now: number): TaskInfo[] {
  const keep = history.filter((task) => now - (task.endedAt ?? now) < COMPLETED_KEEP_MS && !running.some((live) => live.id === task.id));
  return [...running, ...keep.sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))];
}

import { applyFormats, applySizeLinked } from './formatOps';
import { framedSize, DEFAULT_FRAMING } from '../../core/photoFraming';
import { readVideoZoom } from './videoZoomOps';
import { readSplitFrames, readSplitPanOffset } from './splitFrameOps';
import { readFormatSplits } from './formatSplitOps';
import { describeHistory } from './historySteps';
import { readFormatHistory } from './formatHistory';
import type { PhotoFrame, ShootDescriptor } from '../../core/types';
import { computeCullCounts } from '../../core/cullingEngine';
import type { Photo, Project, TaskInfo, TileState } from '../ui/contract';
import { createDefaultSizes, createEditGroups } from '../ui/stub';
import { editToRecipe } from './recipeMap';
import { readOverlay } from './overlayOps';
import { masksToLayers } from './maskOps';
import { readCrops } from './cropOps';
import { readBoard } from './boardOps';
import type { AutoRun } from './runAuto';
import { sameRecipe } from '../../core/naturalAuto';
import { DEFAULT_EDIT } from '../../core/photoEdits';
import { STRINGS } from '../ui/strings';
import type { AssistSuggestion, EditRecipe, PhotoHistogram } from '../ui/contract';
import type { Task } from '../../core/taskStore';

/** A transparent pixel, so a photo whose picture is not ready yet shows an empty tile rather than a broken image. */
export const BLANK_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** What Auto found for a photo, and what the person has done with it. */
export interface AssistState { run: AutoRun; dismissed: string[] }

export function matchesAutoSource(run: AutoRun, frame: PhotoFrame): boolean {
  return frame.removedAt == null && run.source.stableKey === frame.stableKey &&
    run.source.originalSha256 === frame.originalSha256 && run.source.framing === frame.framing;
}

/** Only the sliders Auto would move, in the UI's units. */
export function recipeDelta(base: Parameters<typeof editToRecipe>[0], proposal: Parameters<typeof editToRecipe>[0]): Partial<EditRecipe> {
  const before = editToRecipe(base), after = editToRecipe(proposal);
  return Object.fromEntries((Object.keys(after) as (keyof EditRecipe)[]).filter((key) => before[key] !== after[key]).map((key) => [key, after[key]])) as Partial<EditRecipe>;
}

export function assistCritiqueFor(assist: AssistState | undefined, currentEdit = DEFAULT_EDIT): Photo['assistCritique'] {
  if (!assist) return { subjectNote: '', colourConfidence: '', kelvinEstimate: '', suggestions: [] };
  const { run } = assist;
  const matching = run.candidates.find((candidate) => candidate.edit === currentEdit);
  const available = matching ? [matching] : sameRecipe(run.plan.base, currentEdit) ? run.candidates : [];
  const suggestions: AssistSuggestion[] = available.filter((candidate) => !assist.dismissed.includes(candidate.id))
    .map((candidate) => ({
      id: candidate.id,
      title: STRINGS.copilot.treatments[candidate.id],
      summary: candidate.summary || run.headline,
      colourReadout: run.plan.species.reason,
      applied: candidate === matching,
      recipeDelta: recipeDelta(run.plan.base, candidate.edit),
      comparison: { before: run.before, after: candidate.after },
    }));
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
export interface PhotoExtras { pixelSize?: { width: number; height: number }; /** Measured from a connected, decoded JPEG/PNG original, not EXIF or a preview. */ verifiedOriginalSize?: { width: number; height: number }; assist?: AssistState; watermarkAuto?: 'light-on-dark' | 'dark-on-light'; histogram?: PhotoHistogram; originalConnected?: boolean }

export function frameToPhoto(frame: PhotoFrame, urls: FrameUrls | undefined, extras: PhotoExtras = {}): Photo {
  const { assist, watermarkAuto, histogram, pixelSize, verifiedOriginalSize } = extras;
  const nativeSize = verifiedOriginalSize && /\.(?:jpe?g|png)$/i.test(frame.filename) &&
    Number.isSafeInteger(verifiedOriginalSize.width) && Number.isSafeInteger(verifiedOriginalSize.height) &&
    verifiedOriginalSize.width > 0 && verifiedOriginalSize.height > 0
    ? framedSize(verifiedOriginalSize.width, verifiedOriginalSize.height, frame.framing ?? DEFAULT_FRAMING) : null;
  const { exif } = frame;
  // Recorded sensor dimensions are evidence for the *format shape*, not proof
  // that a preview-only RAW has full native pixels available to export.
  const reportedSize = exif.width && exif.height && Number.isSafeInteger(exif.width) &&
    Number.isSafeInteger(exif.height) && exif.width > 0 && exif.height > 0
    ? framedSize(exif.width, exif.height, frame.framing ?? DEFAULT_FRAMING) : null;
  const originalFormatSize = nativeSize ?? reportedSize;
  // The UI's sample group carries a made-up look. A real photo starts from its own edit: neutral until the person edits it.
  const board = readBoard(frame.boardPositions);
  const crops = readCrops(frame.sizeCrops);
  const groups = createEditGroups(false).map((group) => ({
    ...group, name: 'Edit group 1', recipe: { ...editToRecipe(frame.edit), lookId: frame.appliedLookId ?? 'natural-raw' }, overlay: readOverlay(frame.overlay),
    splitFrames: readSplitFrames(frame.splitFrames), splitPanOffset: readSplitPanOffset(frame.splitPanOffset),
  }));
  const thumb = urls?.thumb ?? BLANK_IMAGE;
  return {
    id: frame.id,
    filename: frame.filename,
    title: titleOf(frame.filename),
    previewUrl: urls?.preview ?? thumb,
    thumbUrl: thumb,
    state: tileStateFor(urls),
    decision: frame.decision,
    originalConnected: extras.originalConnected ?? !urls?.failed,
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
    ...(nativeSize ? { pixelSize: { width: nativeSize.width, height: nativeSize.height } } : exif.width && exif.height ? { pixelSize: { width: exif.width, height: exif.height } } : pixelSize ? { pixelSize } : {}),
    activeGroupId: groups[0].id,
    editGroups: groups,
    sizes: applySizeLinked(applyFormats(createDefaultSizes(), frame.formats, originalFormatSize).map((size) => { const crop = crops[size.id]; const at = board[size.id]; return { ...size, ...(crop ? { crop } : {}), ...(at ? { boardX: at.x, boardY: at.y } : {}) }; }), frame.sizeLinked),
    formatSplits: frame.formatSplits === undefined && frame.splitFrames === true
      ? { 'orig-3x2': { enabled: true, offset: readSplitPanOffset(frame.splitPanOffset) } }
      : readFormatSplits(frame.formatSplits),
    videoZoom: readVideoZoom(frame.videoZoom),
    masks: masksToLayers(frame.edit?.masks),
    ...(frame.burstGroupId && frame.burstCount > 1 ? { burst: { groupId: frame.burstGroupId, index: frame.burstIndex, count: frame.burstCount, ungrouped: Boolean(frame.burstUngrouped), ...(typeof frame.cullScore === 'number' ? { score: frame.cullScore } : {}) } } : {}),
    ...(describeHistory(frame.editHistory) ? { editHistory: describeHistory(frame.editHistory) } : {}),
    ...(frame.formatHistory ? { formatHistory: readFormatHistory(frame.formatHistory).events.map(({ formatId, kind, at, parentFormatId, forkEditCursor }) => ({ formatId, kind, at, ...(parentFormatId ? { parentFormatId } : {}), ...(forkEditCursor !== undefined ? { forkEditCursor } : {}) })) } : {}),
    ...(watermarkAuto ? { watermarkAuto } : {}),
    ...(histogram ? { histogram } : {}),
    assistCritique: assistCritiqueFor(assist && matchesAutoSource(assist.run, frame) ? assist : undefined, frame.edit),
  };
}

export function shootToProject(shoot: ShootDescriptor, frames: readonly PhotoFrame[], coverUrl = ''): Project {
  const live = frames.filter((frame) => !frame.removedAt);
  return {
    id: shoot.id,
    name: shoot.title,
    updatedAt: new Date(shoot.lastUpdatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    coverUrl,
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

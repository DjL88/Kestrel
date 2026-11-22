import type { PhotoFrame, ShootDescriptor } from '../../core/types';
import { computeCullCounts } from '../../core/cullingEngine';
import type { Photo, Project, TaskInfo, TileState } from '../ui/contract';
import { createDefaultSizes, createEditGroups } from '../ui/stub';
import type { Task } from '../../core/taskStore';

/** A transparent pixel, so a photo whose picture is not ready yet shows an empty tile rather than a broken image. */
export const BLANK_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export interface FrameUrls { thumb?: string; preview?: string; failed?: boolean }

const NOT_RECORDED = 'Not recorded';

const titleOf = (filename: string) => filename.replace(/\.[^./\\]+$/, '');
const extensionOf = (filename: string) => /\.([^./\\]+)$/.exec(filename)?.[1]?.toUpperCase();

export function tileStateFor(urls: FrameUrls | undefined): TileState {
  if (urls?.failed) return 'unavailable';
  return urls?.thumb ? 'ready' : 'importing';
}

/**
 * One catalogue photo as the V2 UI's Photo. Only what the catalogue actually holds is filled in: a field the file did
 * not record says "Not recorded" (or is left empty), never an invented value. The edit, size and mask parts start as the
 * UI's neutral defaults; they are connected to the real recipe in a later step.
 */
export function frameToPhoto(frame: PhotoFrame, urls: FrameUrls | undefined): Photo {
  const { exif } = frame;
  const groups = createEditGroups(false);
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
    speciesLabel: frame.subjectNames?.[0],
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
    activeGroupId: groups[0].id,
    editGroups: groups,
    sizes: createDefaultSizes(),
    videoZoom: { enabled: false, focalX: 50, focalY: 50, direction: 'in', durationSec: 6 },
    masks: [],
    assistCritique: { subjectNote: '', colourConfidence: '', kelvinEstimate: '', suggestions: [] },
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
  };
}

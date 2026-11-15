import { createDemoShootState } from './cullingEngine';
import { LEGACY_SETTINGS, type ProjectSettings } from './projectSettings';
import type { CullingState, PhotoFrame } from './types';

export function createEmptyProject(
  id: string, title: string, options?: { keeperTarget?: number; settings?: ProjectSettings },
): CullingState {
  const empty = createDemoShootState(0);
  return {
    ...empty, shoot: { ...empty.shoot, id, title, sourceKind: 'local-files' },
    ...(options?.keeperTarget ? { keeperTarget: options.keeperTarget } : {}),
    ...(options?.settings ? { settings: options.settings } : {}),
  };
}

export function appendProjectPhotos(
  project: CullingState, incoming: PhotoFrame[], importId: string,
): CullingState {
  const seen = new Set(project.frames.filter((frame) => !frame.removedAt).map((frame) => frame.stableKey));
  // Adding a removed photo again brings it back as a fresh, unreviewed photo instead of silently doing nothing.
  const removedByKey = new Map(project.frames.filter((frame) => frame.removedAt).map((frame) => [frame.stableKey, frame.id]));
  const revived = new Set<string>();
  const added: PhotoFrame[] = [];
  const sequenceStart = project.frames.reduce((max, frame) => Math.max(max, frame.sequenceIndex), 0);
  for (const frame of incoming) {
    if (seen.has(frame.stableKey)) continue;
    seen.add(frame.stableKey);
    const revivedId = removedByKey.get(frame.stableKey);
    if (revivedId) {
      revived.add(revivedId);
      continue;
    }
    added.push({
      ...frame,
      id: `${importId}-${frame.id}`,
      sequenceIndex: sequenceStart + added.length + 1,
      burstGroupId: frame.burstGroupId ? `${frame.burstGroupId}-${importId}` : null,
    });
  }
  if (!added.length && !revived.size) return project;
  const frames = [...project.frames.map((frame) => {
    if (!revived.has(frame.id)) return frame;
    const { removedAt: _removedAt, ...kept } = frame;
    return { ...kept, decision: 'unreviewed' as const };
  }), ...added];
  return {
    ...project, frames,
    selectedFrameId: project.selectedFrameId ?? added[0]?.id ?? [...revived][0] ?? null,
    compareRightFrameId: project.compareRightFrameId ?? frames[1]?.id ?? null,
    shoot: {
      ...project.shoot,
      totalFrames: frames.length,
      lastUpdatedAt: Date.now(),
    },
  };
}

/**
 * Stored copies of local photos that only this project uses, and so can be freed when it is deleted.
 * A copy shared with another project (the same file added twice) is kept.
 */
export function unreferencedBlobKeys(project: CullingState, others: readonly CullingState[]): string[] {
  const used = new Set(others.flatMap((other) => other.frames.filter((frame) => frame.sourceKind === 'file').map((frame) => frame.stableKey)));
  return [...new Set(project.frames.filter((frame) => frame.sourceKind === 'file').map((frame) => frame.stableKey))]
    .filter((key) => !used.has(key));
}

export function setArchived(project: CullingState, archivedAt: number | undefined): CullingState {
  const { archivedAt: _previous, ...shoot } = project.shoot;
  return { ...project, shoot: archivedAt ? { ...shoot, archivedAt } : shoot };
}

export function splitProjects<T extends { archivedAt?: number }>(projects: readonly T[]): { active: T[]; archived: T[] } {
  return { active: projects.filter((project) => !project.archivedAt), archived: projects.filter((project) => project.archivedAt) };
}

export const INBOX_ID = 'quick-edits';

/** The bucket for quick edits. It has the helpers off, so a single photo opens as it is. */
export function createInboxProject(): CullingState {
  const project = createEmptyProject(INBOX_ID, 'Quick edits', { settings: LEGACY_SETTINGS });
  return { ...project, shoot: { ...project.shoot, inbox: true } };
}

/** Quick edits first, then the rest in the order given. */
export function inboxFirst<T extends { inbox?: boolean }>(projects: readonly T[]): T[] {
  return [...projects.filter((project) => project.inbox), ...projects.filter((project) => !project.inbox)];
}

export interface MoveResult { source: CullingState; target: CullingState; moved: number; skipped: number }

/**
 * Move photos from one project to another. Their choices, edits, masks and crops go with them. A photo and its virtual
 * copies always move together, and a photo whose file is already in the target stays where it is.
 */
export function moveFrames(source: CullingState, target: CullingState, frameIds: readonly string[], importId: string): MoveResult {
  const byId = new Map(source.frames.map((frame) => [frame.id, frame]));
  const groups = new Set<string>();
  for (const id of frameIds) {
    const frame = byId.get(id);
    if (frame && !frame.removedAt) groups.add(frame.virtualCopy?.originalFrameId ?? frame.id);
  }
  const present = new Set(target.frames.filter((frame) => !frame.removedAt).map((frame) => frame.stableKey));
  const moving: PhotoFrame[] = [];
  let skipped = 0;
  for (const originalId of groups) {
    const original = byId.get(originalId);
    if (!original) continue;
    if (present.has(original.stableKey)) { skipped += 1; continue; }
    moving.push(...source.frames.filter((frame) => frame.id === originalId || frame.virtualCopy?.originalFrameId === originalId));
  }
  if (!moving.length) return { source, target, moved: 0, skipped };

  const moved = new Set(moving.map((frame) => frame.id));
  const start = target.frames.reduce((max, frame) => Math.max(max, frame.sequenceIndex), 0);
  const renamed = moving.map((frame, index): PhotoFrame => ({
    ...frame,
    id: `${importId}-${frame.id}`,
    sequenceIndex: start + index + 1,
    burstGroupId: frame.burstGroupId ? `${frame.burstGroupId}-${importId}` : null,
    virtualCopy: frame.virtualCopy ? { ...frame.virtualCopy, originalFrameId: `${importId}-${frame.virtualCopy.originalFrameId}` } : undefined,
  }));
  const targetFrames = [...target.frames, ...renamed];
  const sourceFrames = source.frames.filter((frame) => !moved.has(frame.id));
  const now = Date.now();
  const stillThere = (id: string | null) => (id && !moved.has(id) ? id : null);
  const firstLeft = sourceFrames.find((frame) => !frame.removedAt)?.id ?? null;
  return {
    moved: renamed.length, skipped,
    target: { ...target, frames: targetFrames, selectedFrameId: target.selectedFrameId ?? renamed[0].id,
      shoot: { ...target.shoot, totalFrames: targetFrames.length, lastUpdatedAt: now } },
    // The history of flag changes points at photos that are no longer here, so it starts afresh.
    source: { ...source, frames: sourceFrames, selectedFrameId: stillThere(source.selectedFrameId) ?? firstLeft,
      compareRightFrameId: stillThere(source.compareRightFrameId), undoStack: [], redoStack: [],
      shoot: { ...source.shoot, totalFrames: sourceFrames.length, lastUpdatedAt: now } },
  };
}

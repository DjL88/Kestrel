import { createDemoShootState } from './cullingEngine';
import type { ProjectSettings } from './projectSettings';
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

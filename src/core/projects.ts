import { createDemoShootState } from './cullingEngine';
import type { CullingState, PhotoFrame } from './types';

export function createEmptyProject(id: string, title: string): CullingState {
  const empty = createDemoShootState(0);
  return { ...empty, shoot: { ...empty.shoot, id, title, sourceKind: 'local-files' } };
}

export function appendProjectPhotos(
  project: CullingState, incoming: PhotoFrame[], importId: string,
): CullingState {
  const seen = new Set(project.frames.map((frame) => frame.stableKey));
  const added: PhotoFrame[] = [];
  const sequenceStart = project.frames.reduce((max, frame) => Math.max(max, frame.sequenceIndex), 0);
  for (const frame of incoming) {
    if (seen.has(frame.stableKey)) continue;
    seen.add(frame.stableKey);
    added.push({
      ...frame,
      id: `${importId}-${frame.id}`,
      sequenceIndex: sequenceStart + added.length + 1,
      burstGroupId: frame.burstGroupId ? `${frame.burstGroupId}-${importId}` : null,
    });
  }
  if (!added.length) return project;
  const frames = [...project.frames, ...added];
  return {
    ...project, frames,
    selectedFrameId: project.selectedFrameId ?? added[0].id,
    compareRightFrameId: project.compareRightFrameId ?? frames[1]?.id ?? null,
    shoot: {
      ...project.shoot,
      totalFrames: frames.length,
      lastUpdatedAt: Date.now(),
    },
  };
}

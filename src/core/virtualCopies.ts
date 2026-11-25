import type { PhotoFrame } from './types';

export function createVirtualCopy(source: PhotoFrame, frames: readonly PhotoFrame[], id: string): PhotoFrame {
  const rootId = source.virtualCopy?.originalFrameId ?? source.id;
  const original = frames.find((frame) => frame.id === rootId) ?? source;
  const next = 1 + frames.reduce((highest, frame) =>
    frame.virtualCopy?.originalFrameId === rootId ? Math.max(highest, frame.virtualCopy.number) : highest, 0);
  const extensionAt = original.filename.lastIndexOf('.');
  const stem = extensionAt > 0 ? original.filename.slice(0, extensionAt) : original.filename;
  const extension = extensionAt > 0 ? original.filename.slice(extensionAt) : '';

  return {
    ...source,
    id,
    filename: `${stem} · Copy ${next}${extension}`,
    decision: 'unreviewed',
    burstGroupId: null,
    burstIndex: 1,
    burstCount: 1,
    // A copy begins at the source's CURRENT recipe, not its previous
    // branches or delivery receipts. The original identity stays shared.
    editHistory: undefined,
    editVersions: undefined,
    editCheckpoints: undefined,
    formatHistory: undefined,
    lastExport: undefined,
    edit: source.edit ? structuredClone(source.edit) : undefined,
    framing: structuredClone(source.framing),
    overlay: structuredClone(source.overlay),
    v2EditGroups: structuredClone(source.v2EditGroups),
    sizeCrops: structuredClone(source.sizeCrops),
    sizeLinked: structuredClone(source.sizeLinked),
    formats: structuredClone(source.formats),
    boardPositions: structuredClone(source.boardPositions),
    videoZoom: structuredClone(source.videoZoom),
    splitFrames: structuredClone(source.splitFrames),
    splitPanOffset: structuredClone(source.splitPanOffset),
    formatSplits: structuredClone(source.formatSplits),
    removedAt: undefined,
    virtualCopy: { originalFrameId: rootId, number: next },
  };
}

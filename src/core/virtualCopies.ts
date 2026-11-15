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
    editHistory: undefined,
    edit: source.edit ? { ...source.edit } : undefined,
    virtualCopy: { originalFrameId: rootId, number: next },
  };
}

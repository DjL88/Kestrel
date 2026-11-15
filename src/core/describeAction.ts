import type { CullingState, DecisionHistoryEntry, PhotoFrame } from './types';

function name(entry: DecisionHistoryEntry, frames: readonly PhotoFrame[]): string {
  return frames.find((frame) => frame.id === entry.frameId)?.filename ?? 'photo';
}

/** A plain-English name for a flag change, such as "Move fox.jpg to Trash", so Undo and Redo say what they will do. */
export function describeEntry(entry: DecisionHistoryEntry, frames: readonly PhotoFrame[]): string {
  const count = entry.batch?.length ?? 1;
  if (entry.removal) return count > 1 ? `Remove ${count} photos from the library` : `Remove ${name(entry, frames)} from the library`;
  if (entry.batch && count > 1) return `Auto-cull (${count} photos)`;
  const file = name(entry, frames);
  if (entry.nextDecision === 'keep') return `Keep ${file}`;
  if (entry.nextDecision === 'reject') return `Move ${file} to Trash`;
  return `Move ${file} back to review`;
}

export function undoLabel(state: Pick<CullingState, 'undoStack' | 'frames'>): string | undefined {
  const entry = state.undoStack.at(-1);
  return entry ? describeEntry(entry, state.frames) : undefined;
}

export function redoLabel(state: Pick<CullingState, 'redoStack' | 'frames'>): string | undefined {
  const entry = state.redoStack.at(-1);
  return entry ? describeEntry(entry, state.frames) : undefined;
}

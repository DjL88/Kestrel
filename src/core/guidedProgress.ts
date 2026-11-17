import type { CullCounts } from './types';

/**
 * Where a nervous, first-time editor is in the guided journey, worked out from the same counts the rest of the Library
 * already computes (`computeCullCounts`) plus how many keepers still have no edit. Pure and deterministic so it's easy to
 * reason about and test: the UI decides what to show, this just decides which step that is.
 */
export type GuidedStep =
  | 'empty' // No photos in the project yet. Nothing to guide towards.
  | 'reviewing' // Some photos still need a Keep/Trash decision.
  | 'improving' // Every photo is decided, there's at least one keeper, and some keepers have no edit yet.
  | 'ready' // Every photo is decided, there's at least one keeper, and every keeper already has an edit.
  | 'none'; // Every photo is decided, but nothing was kept. Nothing constructive to guide towards.

export function guidedStep(counts: Pick<CullCounts, 'all' | 'unreviewed' | 'keep'>, uneditedKeepers: number): GuidedStep {
  if (counts.all === 0) return 'empty';
  if (counts.unreviewed > 0) return 'reviewing';
  if (counts.keep === 0) return 'none';
  return uneditedKeepers > 0 ? 'improving' : 'ready';
}

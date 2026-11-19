import type { PhotoFrame } from './types';

/**
 * Compare's A is a fixed reference. B only visits live, unique alternatives
 * from the currently visible queue. Unlike a generic selection step, this
 * reports exact ends and handles a B that disappeared after filtering.
 */
export function compareNavigation(
  candidates: readonly PhotoFrame[],
  leftId: string | null,
  rightId: string | null,
): { previous: string | null; next: string | null; currentValid: boolean; referenceValid: boolean; available: number } {
  const referenceValid = leftId !== null && candidates.some((frame) => frame.id === leftId && frame.removedAt == null);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const frame of candidates) {
    if (frame.removedAt != null || frame.id === leftId || seen.has(frame.id)) continue;
    seen.add(frame.id);
    ids.push(frame.id);
  }
  const index = rightId === null ? -1 : ids.indexOf(rightId);
  // An absent B can be recovered by moving forward to the first visible
  // alternative; do not silently change the reference or select a removed B.
  if (!referenceValid) return { previous: null, next: null, currentValid: false, referenceValid: false, available: ids.length };
  if (index === -1) return { previous: null, next: ids[0] ?? null, currentValid: false, referenceValid: true, available: ids.length };
  return {
    previous: index > 0 ? ids[index - 1] : null,
    next: index + 1 < ids.length ? ids[index + 1] : null,
    currentValid: true,
    referenceValid: true,
    available: ids.length,
  };
}

/** Honest progress and explicit recovery for Compare's live filtered queue.
 * Never silently replace a stale B: the user must choose to load the next
 * valid candidate. The A reference is fixed and must remain valid.
 */
export function compareQueueState(
  candidates: readonly PhotoFrame[],
  leftId: string | null,
  rightId: string | null,
): { position: number; total: number; recoveryId: string | null; state: 'ready' | 'missing-reference' | 'missing-comparison' | 'empty' } {
  const nav = compareNavigation(candidates, leftId, rightId);
  if (!nav.referenceValid) return { position: 0, total: nav.available, recoveryId: null, state: 'missing-reference' };
  if (!nav.available) return { position: 0, total: 0, recoveryId: null, state: 'empty' };
  if (!nav.currentValid) return { position: 0, total: nav.available, recoveryId: nav.next, state: 'missing-comparison' };
  const seen = new Set<string>();
  let position = 0;
  for (const frame of candidates) {
    if (frame.removedAt != null || frame.id === leftId || seen.has(frame.id)) continue;
    seen.add(frame.id);
    position++;
    if (frame.id === rightId) return { position, total: nav.available, recoveryId: null, state: 'ready' };
  }
  return { position: 0, total: nav.available, recoveryId: nav.next, state: 'missing-comparison' };
}

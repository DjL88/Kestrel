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

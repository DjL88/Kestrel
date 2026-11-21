import type { PhotoFrame } from './types';

/**
 * Only an already-kept original can anchor duplicate rejection across a rescan.
 * A rejected photo must never cause the last available copy to be discarded.
 * Hash only sizes present in the new candidate set.
 */
export function duplicateAnchorKeys(
  frames: readonly PhotoFrame[], candidateSizes: ReadonlySet<number>,
  sizeOf: (stableKey: string) => number | undefined,
): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const frame of frames) {
    if (frame.decision !== 'keep' || frame.removedAt != null || frame.isDemo || frame.virtualCopy) continue;
    const size = sizeOf(frame.stableKey);
    if (size === undefined || size > 32 * 1024 * 1024 || size < 0 || !candidateSizes.has(size)) continue;
    if (seen.has(frame.stableKey)) continue;
    seen.add(frame.stableKey);
    keys.push(frame.stableKey);
  }
  return keys;
}

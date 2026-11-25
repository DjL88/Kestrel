import type { PhotoFrame } from './types';

export const MAX_DUPLICATE_SCAN_BYTES = 256 * 1024 * 1024;
export function isDuplicateScanSize(size: number | undefined): size is number {
  return size !== undefined && Number.isSafeInteger(size) && size > 0 && size <= MAX_DUPLICATE_SCAN_BYTES;
}

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
    if (!isDuplicateScanSize(size) || !candidateSizes.has(size)) continue;
    if (seen.has(frame.stableKey)) continue;
    seen.add(frame.stableKey);
    keys.push(frame.stableKey);
  }
  return keys;
}

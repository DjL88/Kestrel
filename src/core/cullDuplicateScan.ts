import { duplicateAnchorKeys, isDuplicateScanSize } from './duplicateAnchors';
import { hashOriginalBytes, isSameOriginalBytes, type OriginalByteSource } from './originalFileIdentity';
import type { PhotoFrame } from './types';

/** One sequential, bounded-memory hashing lane. Unavailable or substituted originals never prove a duplicate. */
export async function scanExactDuplicates(
  candidates: readonly PhotoFrame[], all: readonly PhotoFrame[],
  sizeOf: (key: string) => number | undefined,
  readOriginal: (key: string) => Promise<OriginalByteSource | undefined>,
  signal: AbortSignal,
): Promise<ReadonlySet<string>> {
  const sizes = new Map<number, number>();
  for (const frame of candidates) {
    const size = sizeOf(frame.stableKey);
    if (isDuplicateScanSize(size)) sizes.set(size, (sizes.get(size) ?? 0) + 1);
  }
  const seen = new Set<string>();
  const anchorSizes = new Set<number>();
  const duplicates = new Set<string>();
  const fingerprint = async (key: string, size: number, expected?: string) => {
    signal.throwIfAborted();
    try {
      const source = await readOriginal(key);
      if (!source || source.size !== size) return undefined;
      const hash = await hashOriginalBytes(source, signal);
      signal.throwIfAborted();
      return !expected || isSameOriginalBytes(expected, hash) ? hash : undefined;
    } catch {
      signal.throwIfAborted();
      return undefined;
    }
  };
  for (const key of duplicateAnchorKeys(all, new Set(sizes.keys()), sizeOf)) {
    const size = sizeOf(key);
    if (!isDuplicateScanSize(size)) continue;
    const keeper = all.find(f => f.stableKey === key && f.decision === 'keep' && f.removedAt == null && !f.isDemo && !f.virtualCopy);
    const hash = await fingerprint(key, size, keeper?.originalSha256);
    if (hash) { seen.add(hash); anchorSizes.add(size); }
  }
  for (const frame of candidates) {
    signal.throwIfAborted();
    const size = sizeOf(frame.stableKey);
    if (!isDuplicateScanSize(size) || ((sizes.get(size) ?? 0) < 2 && !anchorSizes.has(size))) continue;
    const hash = await fingerprint(frame.stableKey, size, frame.originalSha256);
    if (!hash) continue;
    if (seen.has(hash)) duplicates.add(frame.id);
    else seen.add(hash);
  }
  return duplicates;
}

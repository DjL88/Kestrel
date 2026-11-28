import type { Rgb16Image } from '../../core/master16';

/**
 * One RAW decode per photo in an export, not one per format or variant. Export items for a photo run one after another,
 * so a single entry is enough; a different photo replaces it. The cached picture is never edited in place: each output
 * frames and edits its own copy. Kept only while the decode plus that copy fit the memory budget; otherwise every
 * output decodes again (slower, never riskier).
 */
export interface RawSourceCache {
  /** The decoded picture for `key`, opening it once. `shared` says whether the caller must not edit it in place. */
  get(key: string, open: () => Promise<Rgb16Image>): Promise<{ image: Rgb16Image; shared: boolean }>;
  clear(): void;
}

export function createRawSourceCache(budgetBytes: number): RawSourceCache {
  let entry: { key: string; image: Rgb16Image } | null = null;
  let generation = 0;
  return {
    async get(key, open) {
      if (entry?.key === key) return { image: entry.image, shared: true };
      const owner = ++generation;
      entry = null;
      const image = await open();
      // A watchdog/cancel can let another render begin before this decode returns.
      // Only the newest request may retain its image. A superseded result belongs
      // solely to its original caller and cannot resurrect a cleared cache.
      if (owner === generation && image.data.byteLength * 2 <= budgetBytes) {
        entry = { key, image };
        return { image, shared: true };
      }
      return { image, shared: false };
    },
    clear() { generation++; entry = null; },
  };
}

/** How much memory an export may hold for RAW pictures on this device. Unknown browsers get the cautious phone figure. */
export function rawSourceBudget(env: { nativeDesktop: boolean; deviceMemoryGb?: number }): number {
  const MB = 1024 * 1024;
  if (env.nativeDesktop) return 2048 * MB;
  if (env.deviceMemoryGb && env.deviceMemoryGb > 0) return Math.min(2048, env.deviceMemoryGb * 1024 / 4) * MB;
  return 384 * MB;
}

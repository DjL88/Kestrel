/**
 * Stage cache for live edits (x-std-stage-cache), in the manner of darktable's pixelpipe cache.
 *
 * The live picture runs a fixed chain: the stored AI denoise, lens and fringe correction, spot healing, noise
 * reduction, dehaze and capture sharpening, and only then tone, colour, masks and finishing. The early stages are the
 * slow ones (whole-picture neighbourhood filters on the CPU), yet a drag of Exposure, Contrast, a colour slider, a mask
 * or the vignette changes none of their inputs. So the picture after each early stage that ran is kept, keyed by
 * everything that stage and the ones before it read, and the next render starts from the deepest stage whose key still
 * matches. Dragging a late slider skips every early stage; dragging Dehaze re-runs only dehaze and what follows.
 *
 * Correctness rule: a key holds every input of the stages it covers (source picture, size, scale, where the canvas sits
 * on the framed photo, and the stage settings), so a hit gives exactly the pixels a full render would. Anything a key
 * cannot describe (no source key from the caller) is never cached. The cache only ever saves time: a miss renders in
 * full, as before.
 *
 * Memory: snapshots are evicted least recently used first, within a byte limit taken from the device's memory budget
 * (src/core/memoryBudget.ts, `stageCacheBytes`). A snapshot larger than the whole limit is not kept.
 */

/** Pixels as `getImageData` returns them; `putImageData` puts them back unchanged, colour space included. */
export interface StageSnapshot {
  readonly data: { readonly length: number };
  readonly width: number;
  readonly height: number;
}

export interface StageCacheStats { hits: number; misses: number; bytes: number; entries: number; evictions: number }

export interface StageCache {
  readonly maxBytes: number;
  get(key: string): StageSnapshot | undefined;
  set(key: string, snapshot: StageSnapshot): void;
  clear(): void;
  stats(): StageCacheStats;
}

export function createStageCache(maxBytes: number): StageCache {
  const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : 0;
  // A Map keeps insertion order, so the first key is always the least recently used one.
  const entries = new Map<string, StageSnapshot>();
  let bytes = 0;
  let hits = 0;
  let misses = 0;
  let evictions = 0;
  const sizeOf = (snapshot: StageSnapshot) => snapshot.data.length;
  const remove = (key: string) => {
    const old = entries.get(key);
    if (!old) return;
    entries.delete(key);
    bytes -= sizeOf(old);
  };
  return {
    maxBytes: limit,
    get(key) {
      const found = entries.get(key);
      if (!found) { misses++; return undefined; }
      hits++;
      entries.delete(key);
      entries.set(key, found);
      return found;
    },
    set(key, snapshot) {
      const size = sizeOf(snapshot);
      remove(key);
      if (size > limit) return;
      while (bytes + size > limit && entries.size) {
        remove(entries.keys().next().value as string);
        evictions++;
      }
      entries.set(key, snapshot);
      bytes += size;
    },
    clear() { entries.clear(); bytes = 0; },
    stats: () => ({ hits, misses, bytes, entries: entries.size, evictions }),
  };
}

/** What a caller passes to use the cache: the cache and a key that names the exact source pixels drawn on the canvas. */
export interface StageCacheUse {
  cache: StageCache;
  /**
   * Names the pixels on the canvas before any edit: the photo's own picture, its framing and the scale it was drawn at.
   * Two renders with the same key must start from identical pixels.
   */
  sourceKey: string;
}

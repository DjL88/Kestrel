import { cullPoolSize } from './cullPoolSize';

/**
 * One memory budget for the whole app (x-std-memory-budget). Every part that holds pictures or models in memory asks
 * here instead of keeping its own fixed number: the culling worker pool, the in-memory preview caches, the culling
 * read-ahead, and how soon idle model copies are let go. One device tier decides them all, so a phone with little
 * memory gets fewer workers, a smaller cache and quicker unloading together, and a big desktop gets more of each.
 *
 * The tier comes from the device's memory when the browser reports it (navigator.deviceMemory: Chromium only, rounded,
 * and never more than 8 GB). When memory is unknown (Safari, WKWebView) a phone counts as "low" and anything else
 * as "standard", which is exactly what the app used before this budget existed. Unknown never becomes "high".
 *
 * These are ceilings for background work, never promises, and nothing here lowers a picture's quality: a smaller
 * cache only means a photo is read again when revisited.
 */
export type DeviceTier = 'low' | 'standard' | 'high';

export interface DeviceFacts {
  /** Device memory in GB when known (navigator.deviceMemory). */
  memoryGB?: number;
  /** Logical cores when known (navigator.hardwareConcurrency). */
  cores?: number;
  /** A phone or tablet, in a browser or the app shell. */
  phone: boolean;
}

export interface MemoryBudget {
  tier: DeviceTier;
  /** Why this tier, in plain words for Settings → Build information and test reports. */
  basis: 'memory' | 'unknown memory, phone' | 'unknown memory';
  /** Culling workers, each holding one copy of the subject detector (src/providers/cullObservationPool.ts). */
  cullWorkers: number;
  /** Full-size preview object URLs kept in memory (src/providers/browserPreviewProvider.ts). */
  fullPreviews: number;
  /** Full RAW developments kept in memory. */
  developedRaws: number;
  /** Culling read-ahead: photos prepared on each side of the one on screen (#1674). */
  readAheadReach: number;
  /** Decoded read-ahead pictures held so the browser does not drop them at once. */
  readAheadHeld: number;
  /** How long a model copy may sit unused before it is let go. */
  modelIdleUnloadMs: number;
}

/** Per tier. "standard" keeps the numbers the app used before the budget (24 previews, 8 RAWs, 1 each side, 4 held). */
export const TIER_LIMITS: Record<DeviceTier, Omit<MemoryBudget, 'tier' | 'basis' | 'cullWorkers'> & { cullWorkers: number }> = {
  low: { cullWorkers: 2, fullPreviews: 8, developedRaws: 3, readAheadReach: 1, readAheadHeld: 2, modelIdleUnloadMs: 20_000 },
  standard: { cullWorkers: 4, fullPreviews: 24, developedRaws: 8, readAheadReach: 1, readAheadHeld: 4, modelIdleUnloadMs: 60_000 },
  high: { cullWorkers: 6, fullPreviews: 48, developedRaws: 12, readAheadReach: 2, readAheadHeld: 6, modelIdleUnloadMs: 120_000 },
};

export function deviceTier(facts: DeviceFacts): { tier: DeviceTier; basis: MemoryBudget['basis'] } {
  const memory = facts.memoryGB;
  if (typeof memory === 'number' && Number.isFinite(memory) && memory > 0) {
    // Browsers report 0.25 to 8. A phone is never "high": its memory is shared with the camera, the screen and other apps.
    const tier: DeviceTier = memory < 4 ? 'low' : memory >= 8 && !facts.phone ? 'high' : 'standard';
    return { tier, basis: 'memory' };
  }
  return facts.phone ? { tier: 'low', basis: 'unknown memory, phone' } : { tier: 'standard', basis: 'unknown memory' };
}

export function memoryBudget(facts: DeviceFacts): MemoryBudget {
  const { tier, basis } = deviceTier(facts);
  const limits = TIER_LIMITS[tier];
  return {
    ...limits,
    tier,
    basis,
    // Every core but one (at most 4 on phones), and never more than this tier's memory allows.
    cullWorkers: Math.max(1, Math.min(limits.cullWorkers, cullPoolSize(facts.cores, facts.phone))),
  };
}

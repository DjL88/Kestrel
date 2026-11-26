import { memoryBudget, type MemoryBudget } from '../core/memoryBudget';
import { looksLikePhone } from '../core/cullPoolSize';

/** This device's memory budget (src/core/memoryBudget.ts), worked out once from what the browser reports. */
let cached: MemoryBudget | null = null;

export function deviceMemoryBudget(): MemoryBudget {
  if (cached) return cached;
  const nav = typeof navigator === 'undefined' ? undefined : navigator as Navigator & { deviceMemory?: number };
  cached = memoryBudget({ memoryGB: nav?.deviceMemory, cores: nav?.hardwareConcurrency, phone: looksLikePhone(nav?.userAgent) });
  return cached;
}

import { createStageCache, type StageCache } from '../core/stageCache';
import { deviceMemoryBudget } from './deviceBudget';

/** The one stage cache for live edits on this device, sized from the memory budget (x-std-stage-cache). */
let cache: StageCache | null = null;

export function liveStageCache(): StageCache {
  cache ??= createStageCache(deviceMemoryBudget().stageCacheBytes);
  return cache;
}

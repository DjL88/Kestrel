/**
 * What each model actually cost on this machine (P0 #703: version, hash, load time, memory and speed on a real
 * machine). Load and run times are measured when a model really loads and runs, or by Settings → Models → Measure
 * now on a synthetic input, and kept only in memory for this session. Nothing is estimated: a value that was not
 * measured stays null and the screen says so. Browser models cannot have their memory read live (the browser engine
 * cannot see the WebAssembly runtime's memory), so the catalogue shows the peak measured at conversion; the desktop
 * vision model's memory is read from the operating system by the Rust runtime and recorded here.
 */

export interface ModelStat {
  /** Time to create the runtime session from verified bytes, in milliseconds (the latest load). */
  loadMs: number | null;
  /** Durations of recent runs, newest last (at most 20). */
  runsMs: number[];
  /** Resident memory the process gained while the model loaded, read from the operating system. Null where it cannot be read. */
  loadRamBytes: number | null;
  /** How the numbers were taken. */
  source: 'use' | 'measure' | null;
}

const MAX_RUNS = 20;
const stats = new Map<string, ModelStat>();
const listeners = new Set<() => void>();
let version = 0;

const fresh = (): ModelStat => ({ loadMs: null, runsMs: [], loadRamBytes: null, source: null });
const changed = () => { version += 1; for (const listener of listeners) listener(); };
const finite = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

export function recordModelLoad(id: string, loadMs: number, source: 'use' | 'measure' = 'use'): void {
  if (!id || !finite(loadMs)) return;
  const stat = stats.get(id) ?? fresh();
  stats.set(id, { ...stat, loadMs, source });
  changed();
}

export function recordModelRun(id: string, ms: number, source: 'use' | 'measure' = 'use'): void {
  if (!id || !finite(ms)) return;
  const stat = stats.get(id) ?? fresh();
  stats.set(id, { ...stat, runsMs: [...stat.runsMs, ms].slice(-MAX_RUNS), source: stat.source ?? source });
  changed();
}

export function recordModelMemory(id: string, loadRamBytes: number, source: 'use' | 'measure' = 'use'): void {
  if (!id || !finite(loadRamBytes)) return;
  const stat = stats.get(id) ?? fresh();
  stats.set(id, { ...stat, loadRamBytes, source: stat.source ?? source });
  changed();
}

export function modelStat(id: string): ModelStat | null { return stats.get(id) ?? null; }

/** The middle run time, the honest "speed" of a model on this machine. Null before any run. */
export function medianRunMs(stat: Pick<ModelStat, 'runsMs'> | null): number | null {
  if (!stat || !stat.runsMs.length) return null;
  const sorted = [...stat.runsMs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function subscribeModelStats(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const modelStatsVersion = () => version;

/** For tests. */
export function resetModelStats(): void { stats.clear(); changed(); }

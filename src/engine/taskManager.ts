import { tasks as realTaskStore, type TaskHandle } from '../core/taskStore';
import type { EngineCapability, EngineRunner } from './types';

/**
 * One consistent way for engine work to register with the real task queue (src/core/taskStore.ts,
 * unchanged), instead of each caller hand-rolling its own `tasks.start()`/`finish()`/`fail()` sequence
 * slightly differently (today: useBackgroundDevelop.ts, useSpeciesScan.ts each do their own). This is a
 * new, additive entry point for new engine wiring - existing hooks are NOT migrated to it in this slice,
 * to avoid touching shared App.tsx-adjacent files; that migration is separate, later work.
 *
 * `capability`/`runner` are recorded in the task's detail so the existing Tasks UI (and later, a cloud
 * runner) shows which engine actually did the work, without changing the Task shape itself.
 */
export interface EngineTaskStore {
  start(title: string, options?: { total?: number | null; cancel?: () => void }): TaskHandle;
}

export async function runEngineTask<T>(
  capability: EngineCapability,
  runner: EngineRunner,
  title: string,
  work: (handle: TaskHandle) => Promise<T>,
  options: { total?: number | null; cancel?: () => void; store?: EngineTaskStore } = {},
): Promise<T> {
  const store = options.store ?? realTaskStore;
  const handle = store.start(title, { total: options.total, cancel: options.cancel });
  try {
    const result = await work(handle);
    handle.finish(`${capability} (${runner})`);
    return result;
  } catch (error) {
    handle.fail(error instanceof Error ? error.message : String(error));
    throw error;
  }
}

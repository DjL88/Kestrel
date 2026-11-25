import type { TaskHandle } from '../core/taskStore';
import { engineScheduler, type EngineKind, type EngineResource, type SchedulerTicket } from '../core/engineScheduler';
import type { EngineCapability, EngineRunner } from './types';

/**
 * One consistent way for engine work to reach the Task Manager (`src/core/engineScheduler.ts`), so every engine
 * action shows, waits its turn, orders and cancels like the rest of the background work.
 *
 * - Called from inside a scheduled batch (its `signal` is the one the batch gave its photograph): the work runs
 *   there, as part of that task. Queuing a second batch would wait behind the batch that is waiting for it (the
 *   browser runs one heavy job at a time), and would add a second row for the same work.
 * - Called on its own: the work becomes a one-photograph batch, so it shows in Tasks, waits for a free slot,
 *   follows the person's queue order and can be cancelled there.
 * - `store` (tests and legacy callers): the previous direct task, kept so its behaviour can still be checked.
 *
 * `capability`/`runner` are recorded in the task's detail so Tasks shows which engine did the work.
 */
export interface EngineTaskStore {
  start(title: string, options?: { total?: number | null; cancel?: () => void }): TaskHandle;
}

export interface EngineTaskScheduler {
  submit: typeof engineScheduler.submit;
  isBatchSignal(signal?: AbortSignal | null): boolean;
}

const KIND: Partial<Record<EngineCapability, EngineKind>> = {
  'raw-develop': 'raw', 'subject-detect': 'detect', mask: 'mask', denoise: 'denoise', 'vision-scene': 'vision',
};
const kindOf = (capability: EngineCapability): EngineKind => KIND[capability] ?? 'other';
const resourceOf = (capability: EngineCapability): EngineResource => capability === 'raw-develop' ? 'cpu' : 'gpu';

/** Work run inside another task reports nothing of its own: the batch it belongs to already shows it. */
const silentHandle = (signal?: AbortSignal): TaskHandle => ({
  id: -1, progress: () => {}, finish: () => {}, fail: () => {},
  get cancelled() { return Boolean(signal?.aborted); },
});

const abortError = () => new DOMException('The engine task was cancelled.', 'AbortError');

export async function runEngineTask<T>(
  capability: EngineCapability,
  runner: EngineRunner,
  title: string,
  work: (handle: TaskHandle) => Promise<T>,
  options: {
    total?: number | null; cancel?: () => void; store?: EngineTaskStore;
    /** The caller's cancellation signal. A batch's own signal means "already inside that task". */
    signal?: AbortSignal; scheduler?: EngineTaskScheduler; priority?: number;
  } = {},
): Promise<T> {
  if (options.store) {
    const handle = options.store.start(title, { total: options.total, cancel: options.cancel });
    try {
      const result = await work(handle);
      handle.finish(`${capability} (${runner})`);
      return result;
    } catch (error) {
      handle.fail(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  const scheduler = options.scheduler ?? engineScheduler;
  if (scheduler.isBatchSignal(options.signal)) return work(silentHandle(options.signal));

  options.signal?.throwIfAborted();
  let outcome: { value: T } | null = null;
  let thrown: unknown = undefined;
  let failed = false;
  // The scheduler may start the work before `submit` resolves, so the id is filled in afterwards.
  let taskId = -1;
  const ticket: SchedulerTicket = await scheduler.submit({
    title, kind: kindOf(capability), resource: resourceOf(capability), priority: options.priority,
    pauseable: false, snapshot: undefined,
    items: [title], itemId: () => 'work', itemLabel: label => label,
    runItem: async (_item, _snapshot, ctx) => {
      if (runner !== 'device') ctx.setLocation('cloud');
      // Cancel in Tasks aborts ctx.signal; the work listens to the caller's own signal, so pass it on.
      ctx.signal.addEventListener('abort', () => options.cancel?.(), { once: true });
      const handle: TaskHandle = {
        get id() { return taskId; },
        progress: (done, total, detail) => ctx.reportProgress(done, total ?? done, detail),
        finish: () => {}, fail: () => {},
        get cancelled() { return ctx.signal.aborted; },
      };
      try {
        outcome = { value: await work(handle) };
        ctx.stage(`${capability} (${runner})`);
      } catch (error) {
        failed = true;
        thrown = error;
        throw error;
      }
    },
  });
  taskId = ticket.taskId;
  const onAbort = () => { ticket.cancel(); options.cancel?.(); };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const result = await ticket.finished;
    if (result === 'done' && outcome) return (outcome as { value: T }).value;
    if (failed) throw thrown;
    throw abortError();
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
  }
}

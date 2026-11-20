/**
 * App-lifetime export queue: not tied to the Export dialog's React lifecycle.
 * Callers own source identity validation, destination permissions, atomic writes
 * and resumable persistence; jobs do not survive an app restart yet.
 */
import { tasks, type TaskHandle } from './taskStore';

export interface ExportBatchItem {
  readonly sourceId: string;
  readonly filename: string;
  readonly subfolder: string;
}
export type ExportBatchResult = 'completed' | 'cancelled' | 'failed';
export interface ExportBatchPlan<Recipe> {
  readonly title: string;
  readonly items: readonly ExportBatchItem[];
  readonly recipe: Recipe;
  /** Only enable for destinations that atomically reject existing file names.
   * This is a same-app-session retry, NOT crash/restart resume. */
  readonly retrySafe?: boolean;
}
export interface ExportBatchAdapter<Recipe, Output> {
  render(item: Readonly<ExportBatchItem>, recipe: Readonly<Recipe>, signal: AbortSignal): Promise<Output>;
  /** Resolve only after destination confirms the completed write. */
  save(item: Readonly<ExportBatchItem>, output: Output, signal: AbortSignal): Promise<void>;
}
export interface ExportBatchTicket {
  readonly id: number;
  readonly done: Promise<ExportBatchResult>;
  cancel(): boolean;
}
export type ExportTaskStore = Pick<typeof tasks, 'start' | 'cancel' | 'list' | 'dismissFinished'>;
const invalid = /[\\/:*?"<>|\u0000-\u001f]/;

export function exportFolderName(value: string): string {
  if (value === '') return '';
  const name = value.trim();
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) throw new Error('Invalid export subfolder.');
  const safe = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\.+$/, '').slice(0, 64);
  if (!safe || safe === '.' || safe === '..') throw new Error('Invalid export subfolder.');
  return safe;
}

/** Snapshot at submit time; do not retain live editor state or DOM handles. */
export function snapshotExportRecipe<Recipe>(recipe: Recipe): Readonly<Recipe> {
  const copy = structuredClone(recipe);
  const deepFreeze = (value: unknown, seen = new WeakSet<object>()): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    for (const entry of Object.values(value)) deepFreeze(entry, seen);
    Object.freeze(value);
  };
  deepFreeze(copy);
  return copy;
}

export function createExportBatchQueue(taskStore: ExportTaskStore = tasks) {
  const pending = new Map<number, () => Promise<void>>();
  // Never keep user photographs or destination handles indefinitely. Only
  // failed, explicitly retry-safe jobs are retained, with a bounded history.
  const retryable = new Map<number, () => ExportBatchTicket>();
  const MAX_RETRY_JOBS = 5;
  const MAX_ATTEMPTS = 4; // initial run plus at most three explicit retries
  let running = false;
  let nextId = 0;
  function drain(): void {
    if (running) return;
    const next = pending.entries().next();
    if (next.done) return;
    const [id, run] = next.value;
    pending.delete(id);
    running = true;
    void run().finally(() => { running = false; drain(); });
  }
  const retryPresent = (taskId: number): boolean =>
    taskStore.list().some(task => task.id === taskId && task.state === 'failed');
  function pruneRetryHistory(): void {
    for (const id of retryable.keys()) {
      if (!retryPresent(id)) retryable.delete(id);
    }
    while (retryable.size > MAX_RETRY_JOBS) {
      const first = retryable.keys().next().value;
      if (first === undefined) break;
      retryable.delete(first);
    }
  }
  return {
    enqueue<Recipe, Output>(plan: ExportBatchPlan<Recipe>, adapter: ExportBatchAdapter<Recipe, Output>): ExportBatchTicket {
      if (!plan.items.length) throw new Error('Select at least one photo and export format.');
      const used = new Set<string>();
      const items = plan.items.map((item): Readonly<ExportBatchItem> => {
        if (!item.sourceId || !item.filename || item.filename === '.' || item.filename === '..' ||
          invalid.test(item.filename)) throw new Error('An export filename or source identifier is invalid.');
        const copy = Object.freeze({
          sourceId: item.sourceId, filename: item.filename, subfolder: exportFolderName(item.subfolder),
        });
        const key = `${copy.subfolder}/${copy.filename}`.toLocaleLowerCase('en-US');
        if (used.has(key)) throw new Error('Two exports target the same filename in one destination.');
        used.add(key);
        return copy;
      });
      const recipe = snapshotExportRecipe(plan.recipe);
      const retrySafe = plan.retrySafe === true;
      const title = plan.title;

      // Retrying is an explicit fresh task in the SAME app session. The source
      // recipe and destination remain the submitted snapshot; successfully
      // saved files are skipped. A destination that cannot promise exclusive
      // writes must never enable retrySafe.
      function begin(startIndex: number, attempt: number): ExportBatchTicket {
        const id = ++nextId;
        const controller = new AbortController();
        let handle: TaskHandle | null = null;
        let finished = false;
        let savedCount = startIndex;
        let resolveDone!: (result: ExportBatchResult) => void;
        const done = new Promise<ExportBatchResult>((resolve) => { resolveDone = resolve; });
        const cancel = () => {
          if (finished || controller.signal.aborted) return false;
          controller.abort();
          if (handle) taskStore.cancel(handle.id);
          if (pending.delete(id)) {
            finished = true;
            resolveDone('cancelled');
          }
          return true;
        };
        handle = taskStore.start(title, { total: items.length, cancel });
        if (startIndex > 0) handle.progress(startIndex, items.length, `${startIndex} already saved`);
        pending.set(id, async () => {
          if (controller.signal.aborted || handle?.cancelled) {
            finished = true;
            handle?.finish();
            resolveDone('cancelled');
            return;
          }
          try {
            for (let index = startIndex; index < items.length; index++) {
              if (controller.signal.aborted || handle?.cancelled) break;
              const rendered = await adapter.render(items[index], recipe, controller.signal);
              if (controller.signal.aborted || handle?.cancelled) break;
              await adapter.save(items[index], rendered, controller.signal);
              savedCount = index + 1; // only advance after confirmed write success
              handle?.progress(savedCount, items.length, `${savedCount} of ${items.length} saved`);
            }
            if (controller.signal.aborted || handle?.cancelled) {
              handle?.fail('Export stopped. Files already saved remain at the destination.');
              resolveDone('cancelled');
            } else {
              handle?.finish(`${items.length} files saved`);
              resolveDone('completed');
            }
          } catch (error) {
            if (controller.signal.aborted || handle?.cancelled) resolveDone('cancelled');
            else {
              if (retrySafe && savedCount < items.length && attempt + 1 < MAX_ATTEMPTS && handle) {
                // Register before fail() emits, so the Retry button appears
                // in the same Task Manager update as the error.
                retryable.set(handle.id, () => begin(savedCount, attempt + 1));
                pruneRetryHistory();
              }
              handle?.fail(error instanceof Error ? error.message : 'Could not save the export.');
              resolveDone('failed');
            }
          } finally { finished = true; }
        });
        drain();
        return Object.freeze({ id, done, cancel });
      }
      return begin(0, 0);
    },
    /** Retry only an explicitly safe failed task; it never runs on restart or
     * silently retries an unknown storage operation. */
    canRetryTask(taskId: number): boolean {
      return retryable.has(taskId) && retryPresent(taskId);
    },
    retryTask(taskId: number): ExportBatchTicket | null {
      const retry = retryable.get(taskId);
      if (!retry || !retryPresent(taskId)) { retryable.delete(taskId); return null; }
      const ticket = retry(); // if enqueue fails, keep the original failure
      retryable.delete(taskId);
      taskStore.dismissFinished(taskId);
      pruneRetryHistory();
      return ticket;
    },
  };
}
/** Shared singleton remains alive after Export dialog unmounts. */
export const exportBatchQueue = createExportBatchQueue();

/**
 * Shared device-bounded engine scheduler. Each batch advances one confirmed item
 * at a time. Interactive work can enter between photograph boundaries without
 * redoing completed exports. No cloud transport or upload is performed here.
 *
 * runItem must resolve only after its save or catalogue commit has succeeded.
 * Async engine results must be applied through commitIfCurrent.
 */
import { tasks, type TaskHandle, type TaskItemInfo, type TaskLocation } from './taskStore.ts';

export type EngineResource = 'cpu' | 'gpu' | 'io';
export type EngineKind = 'import' | 'raw' | 'preview' | 'thumbnail' | 'cull' | 'detect' | 'mask' |
  'denoise' | 'auto-edit' | 'vision' | 'export' | 'collage' | 'backup' | 'other';
export type ItemState = TaskItemInfo['state'];
export interface DeviceLimits { cpu: number; gpu: number; io: number }
export interface JobJournal {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}
interface StoredCheckpoint {
  version: 1;
  fingerprint: string;
  completed: string[];
  updatedAt: number;
}
export interface ScheduledContext {
  readonly signal: AbortSignal;
  stage(stage: string): void;
  /** Prevent cancelled, superseded or stale asynchronous engine results from applying. */
  commitIfCurrent(commit: () => void): boolean;
  checkCancelled(): void;
}
export interface BatchDefinition<Item, Snapshot = undefined> {
  title: string;
  kind: EngineKind;
  items: readonly Item[];
  itemId(item: Item): string;
  itemLabel(item: Item): string;
  runItem(item: Readonly<Item>, snapshot: Readonly<Snapshot>, ctx: ScheduledContext): Promise<void>;
  snapshot: Snapshot;
  resource?: EngineResource;
  priority?: number;
  location?: TaskLocation;
  /** Only offer pause when a photo or stage boundary genuinely exists. */
  pauseable?: boolean;
  recovery?: {
    key: string;
    journal: JobJournal;
    /** Required to verify previously saved outputs before any restart recovery. */
    verifyCompleted(item: Item): Promise<boolean>;
  };
}
export interface SchedulerTicket {
  readonly taskId: number;
  readonly finished: Promise<'done' | 'failed' | 'cancelled'>;
  cancel(): boolean;
  pause(): boolean;
  resume(): boolean;
  jumpQueue(): boolean;
  retryFailed(): Promise<SchedulerTicket | null>;
}
interface WorkItem<Item> {
  input: Item;
  id: string;
  label: string;
  state: ItemState;
  detail?: string;
  uncertain?: boolean;
}
interface WorkBatch {
  id: number;
  order: number;
  priority: number;
  resource: EngineResource;
  pauseable: boolean;
  paused: boolean;
  pauseRequested: boolean;
  active: boolean;
  cancelled: boolean;
  controller: AbortController | null;
  handle: TaskHandle;
  items: WorkItem<unknown>[];
  work(index: number, ctx: ScheduledContext): Promise<void>;
  saveCheckpoint(): void;
  retry(): Promise<SchedulerTicket | null>;
  finish(result: 'done' | 'failed' | 'cancelled'): void;
}

export function limitsForDevice(device: { hardwareConcurrency?: number; deviceMemory?: number; mobile?: boolean } = {}): DeviceLimits {
  const cores = Number.isFinite(device.hardwareConcurrency) ? Math.max(1, Math.floor(device.hardwareConcurrency!)) : 2;
  const lowMemory = device.mobile || (device.deviceMemory !== undefined && device.deviceMemory <= 4);
  return { cpu: lowMemory ? 1 : Math.max(1, Math.min(3, cores - 1)), gpu: 1, io: lowMemory ? 1 : 2 };
}

/** Build once per app lifecycle; always reuse the existing taskStore singleton. */
export function createEngineScheduler(options: {
  taskStore?: typeof tasks;
  limits?: DeviceLimits;
  now?: () => number;
} = {}) {
  const store = options.taskStore ?? tasks;
  const limits = options.limits ?? limitsForDevice();
  const now = options.now ?? Date.now;
  const used: DeviceLimits = { cpu: 0, gpu: 0, io: 0 };
  const jobs = new Map<number, WorkBatch>();
  const failedJobs = new Map<number, WorkBatch>();
  let sequence = 0;
  let highest = 100;
  let pausedAll = false;

  const updateItems = (job: WorkBatch, detail?: string) => job.handle.patch({
    items: job.items.map(({ id, label, state, detail: explanation }) => ({ id, label, state, ...(explanation ? { detail: explanation } : {}) })),
    ...(detail !== undefined ? { detail } : {}),
  });
  const countDone = (job: WorkBatch) => job.items.filter(item => item.state === 'done').length;
  const publishProgress = (job: WorkBatch) => {
    const done = countDone(job);
    job.handle.progress(done, job.items.length, `${done} of ${job.items.length} completed`);
    updateItems(job);
  };
  const finishJob = (job: WorkBatch) => {
    if (job.cancelled) return job.finish('cancelled');
    const failed = job.items.filter(item => item.state === 'failed');
    if (failed.length) {
      job.handle.fail(`${failed.length} of ${job.items.length} items failed. Retry failed items only.`);
      return job.finish('failed');
    }
    job.handle.finish(`${job.items.length} of ${job.items.length} completed`);
    job.finish('done');
  };
  const pump = () => {
    if (pausedAll) return;
    // Each dispatch covers only one photograph, then reconsider priority.
    let dispatched = true;
    while (dispatched) {
      dispatched = false;
      const eligible = [...jobs.values()].filter(j => !j.active && !j.paused && !j.pauseRequested && !j.cancelled &&
        j.items.some(item => item.state === 'queued') && used[j.resource] < limits[j.resource]);
      eligible.sort((a, b) => b.priority - a.priority || a.order - b.order);
      const job = eligible[0];
      if (!job) break;
      const index = job.items.findIndex(item => item.state === 'queued');
      if (index < 0) break;
      dispatched = true;
      job.active = true;
      job.order = ++sequence;
      used[job.resource]++;
      const item = job.items[index];
      const controller = new AbortController();
      job.controller = controller;
      item.state = 'running';
      item.detail = undefined;
      job.handle.transition('running', `Working on ${item.label}`);
      updateItems(job);
      const ctx: ScheduledContext = {
        signal: controller.signal,
        stage(stage) {
          if (!job.cancelled && !controller.signal.aborted) {
            item.detail = stage;
            job.handle.patch({ stage, detail: `${item.label}: ${stage}` });
            updateItems(job);
          }
        },
        checkCancelled() {
          controller.signal.throwIfAborted();
          if (job.cancelled) throw new Error('Job cancelled.');
        },
        commitIfCurrent(commit) {
          if (job.cancelled || controller.signal.aborted || item.state !== 'running') return false;
          commit();
          return true;
        },
      };
      void (async () => {
        try {
          await job.work(index, ctx);
          if (controller.signal.aborted || job.cancelled) {
            item.state = 'cancelled';
          } else {
            // Worker has already confirmed actual save. If the checkpoint fails,
            // the destination may still contain the file: forbid blind retry.
            item.state = 'done';
            try { job.saveCheckpoint(); } catch (error) {
              item.uncertain = true;
              throw new Error(`Could not checkpoint confirmed output for ${item.label}: ${error instanceof Error ? error.message : String(error)}. Verify the destination before retrying.`);
            }
          }
        } catch (error) {
          // A cancelled native save picker is cancellation, not a failed image.
          if (error instanceof DOMException && error.name === 'AbortError' && !job.cancelled)
            store.cancel(job.id);
          if (controller.signal.aborted || job.cancelled) item.state = 'cancelled';
          else {
            item.state = 'failed';
            item.detail = error instanceof Error ? error.message : String(error);
          }
        } finally {
          job.active = false;
          job.controller = null;
          used[job.resource] = Math.max(0, used[job.resource] - 1);
          if (job.cancelled) { job.finish('cancelled'); }
          else {
            publishProgress(job);
            if ((job.paused || job.pauseRequested || pausedAll) && job.items.some(item => item.state === 'queued')) {
              job.paused = true;
              job.pauseRequested = false;
              job.handle.transition('paused', `${countDone(job)} of ${job.items.length} completed; paused at a safe boundary`);
            } else if (job.items.some(item => item.state === 'queued')) {
              job.handle.transition('queued', `${countDone(job)} of ${job.items.length} completed; waiting for processing slot`);
            } else finishJob(job);
          }
          pump();
        }
      })();
    }
  };

  async function submit<Item, Snapshot>(definition: BatchDefinition<Item, Snapshot>): Promise<SchedulerTicket> {
    if (!definition.items.length) throw new Error('A processing batch needs at least one item.');
    const ids = definition.items.map(definition.itemId);
    if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error('Batch item identities must be unique and non-empty.');
    const snapshot = structuredClone(definition.snapshot);
    // Only serialisable metadata belongs in the recovery fingerprint.
    // Never journal source bytes, handles, model weights or photographs.
    const fingerprint = JSON.stringify({ kind: definition.kind, items: ids, snapshot });
    const recovery = definition.recovery;
    const completed = new Set<string>();
    if (recovery) {
      const priorText = recovery.journal.getItem(recovery.key);
      if (priorText) {
        const prior = JSON.parse(priorText) as StoredCheckpoint;
        if (prior.version !== 1 || prior.fingerprint !== fingerprint || !Array.isArray(prior.completed))
          throw new Error('The saved job does not match these sources and settings. Start a new batch.');
        for (const id of prior.completed) {
          const index = ids.indexOf(id);
          if (index >= 0) {
            if (!await recovery.verifyCompleted(definition.items[index]))
              throw new Error(`Cannot verify saved output for ${id}. Reconnect the destination before resuming.`);
            completed.add(id);
          }
        }
      }
    }
    const items: WorkItem<Item>[] = definition.items.map((input, i) => ({
      input, id: ids[i], label: definition.itemLabel(input), state: completed.has(ids[i]) ? 'done' : 'queued',
    }));
    let resolveFinished!: (result: 'done' | 'failed' | 'cancelled') => void;
    const finished = new Promise<'done' | 'failed' | 'cancelled'>(resolve => { resolveFinished = resolve; });
    let job!: WorkBatch;
    const handle = store.enqueue(definition.title, {
      total: items.length, location: definition.location ?? 'local', priority: definition.priority ?? 0,
      pauseable: definition.pauseable !== false && items.length > 1,
      cancel: () => {
        job.cancelled = true;
        job.controller?.abort();
        for (const item of job.items) if (item.state === 'queued') item.state = 'cancelled';
        updateItems(job);
        if (!job.active) job.finish('cancelled');
        pump();
      },
    });
    const ticket: SchedulerTicket = {
      taskId: handle.id, finished,
      cancel: () => store.cancel(handle.id),
      pause: () => pause(handle.id),
      resume: () => resume(handle.id),
      jumpQueue: () => jumpQueue(handle.id),
      retryFailed: async () => job.retry(),
    };
    job = {
      id: handle.id, order: ++sequence, priority: definition.priority ?? 0,
      resource: definition.resource ?? 'cpu', pauseable: definition.pauseable !== false && items.length > 1,
      active: false, paused: false, pauseRequested: false, cancelled: false, controller: null,
      handle, items: items as WorkItem<unknown>[],
      work: (index, ctx) => definition.runItem(items[index].input, snapshot, ctx),
      saveCheckpoint: () => {
        if (!recovery) return;
        const data: StoredCheckpoint = { version: 1, fingerprint,
          completed: items.filter(item => item.state === 'done').map(item => item.id), updatedAt: now() };
        recovery.journal.setItem(recovery.key, JSON.stringify(data));
      },
      retry: async () => {
        const failures = items.filter(item => item.state === 'failed' && !item.uncertain);
        if (!failures.length || job.active || job.cancelled) return null;
        return submit({ ...definition, title: `${definition.title} — retry failed`, items: failures.map(item => item.input) });
      },
      finish: result => {
        if (!jobs.has(handle.id)) return;
        jobs.delete(handle.id);
        if (result === 'failed') {
          failedJobs.set(handle.id, job);
          while (failedJobs.size > 5) failedJobs.delete(failedJobs.keys().next().value!);
        }
        resolveFinished(result);
      },
    };
    jobs.set(handle.id, job);
    updateItems(job);
    if (completed.size) {
      handle.transition('running');
      publishProgress(job);
      handle.transition('queued');
    }
    if (items.every(item => item.state === 'done')) finishJob(job);
    else pump();
    return ticket;
  }

  const pause = (id: number): boolean => {
    const job = jobs.get(id);
    if (!job || job.cancelled || !job.pauseable || job.paused || job.pauseRequested) return false;
    if (job.active) { job.pauseRequested = true; job.handle.patch({ detail: 'Pausing after the current photograph' }); }
    else { job.paused = true; job.handle.transition('paused', 'Paused before the next photograph'); }
    return true;
  };
  const resume = (id: number): boolean => {
    const job = jobs.get(id);
    if (!job || job.cancelled || (!job.paused && !job.pauseRequested)) return false;
    job.paused = false;
    job.pauseRequested = false;
    if (!job.active) job.handle.transition('queued', 'Ready to resume');
    pump();
    return true;
  };
  const jumpQueue = (id: number): boolean => {
    const job = jobs.get(id);
    if (!job || job.cancelled || job.paused) return false;
    job.priority = ++highest;
    job.order = --sequence;
    job.handle.patch({ priority: job.priority, detail: 'Prioritised for the next available processing slot' });
    pump();
    return true;
  };
  const reorder = (ids: readonly number[]): boolean => {
    if (new Set(ids).size !== ids.length || ids.some(id => !jobs.has(id) || jobs.get(id)?.active)) return false;
    for (const id of [...ids].reverse()) {
      const job = jobs.get(id)!;
      job.order = ++sequence;
      job.priority = ++highest;
      job.handle.patch({ priority: job.priority });
    }
    pump();
    return true;
  };
  return {
    submit, pause, resume, jumpQueue, reorder,
    cancel: (id: number) => store.cancel(id),
    canRetryFailed: (id: number) => {
      const job = jobs.get(id) ?? failedJobs.get(id);
      return Boolean(job && job.items.some(item => item.state === 'failed' && !item.uncertain));
    },
    retryFailed: async (id: number) => {
      const job = jobs.get(id) ?? failedJobs.get(id);
      const ticket = await job?.retry() ?? null;
      if (ticket) failedJobs.delete(id);
      return ticket;
    },
    pauseAll() {
      pausedAll = true;
      for (const job of jobs.values()) if (job.pauseable) pause(job.id);
    },
    resumeAll() {
      pausedAll = false;
      for (const job of jobs.values()) if (job.paused || job.pauseRequested) resume(job.id);
      pump();
    },
    list: () => store.list(),
    subscribe: store.subscribe,
    runningResourceCount: () => ({ ...used }),
    isPausedAll: () => pausedAll,
  };
}

const nav: Partial<Navigator & { deviceMemory?: number }> = typeof navigator === 'undefined' ? {} : navigator;
export const engineScheduler = createEngineScheduler({
  limits: limitsForDevice({ hardwareConcurrency: nav.hardwareConcurrency, deviceMemory: nav.deviceMemory,
    mobile: typeof navigator !== 'undefined' && /Android|iPhone|iPad/i.test(navigator.userAgent) }),
});

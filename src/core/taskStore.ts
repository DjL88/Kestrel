/**
 * The list of heavy jobs the app is running (exports, assisted culling and so on), so they can be seen in one place and
 * stopped. A job registers itself, reports progress, and says how to cancel it. This is the visibility and control layer;
 * it does not decide when jobs run.
 */
export type TaskState = 'running' | 'done' | 'failed' | 'cancelled';

export interface Task {
  id: number;
  title: string;
  state: TaskState;
  /** A Stop control is only available when the job registered a cancellation callback. */
  cancellable?: boolean;
  done: number;
  total: number | null;
  detail?: string;
  startedAt: number;
  /** When progress last moved, so a stuck task can be told from a slow one. */
  updatedAt: number;
  endedAt?: number;
}

export interface TaskHandle {
  readonly id: number;
  progress(done: number, total?: number | null, detail?: string): void;
  finish(detail?: string): void;
  fail(message: string): void;
  /** True once the person has stopped this task, so the job can quit quietly instead of reporting an error. */
  readonly cancelled: boolean;
}

const KEEP_FINISHED = 5;
const KEEP_FAILED = 5;

export function createTaskStore(now: () => number = Date.now) {
  let tasks: Task[] = [];
  let nextId = 1;
  const cancels = new Map<number, { markCancelled: () => void; stop: () => void }>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  const update = (id: number, change: Partial<Task>) => {
    tasks = tasks.map((task) => (task.id === id ? { ...task, ...change } : task));
    trim();
    emit();
  };
  const isRunning = (id: number) => tasks.find((task) => task.id === id)?.state === 'running';
  const trim = () => {
    // Successful work must not evict an unacknowledged export failure. Keep
    // separate bounded histories so a long session cannot grow without limit.
    const byCompletion = (a: Task, b: Task) => (a.endedAt ?? 0) - (b.endedAt ?? 0) || a.id - b.id;
    const finished = tasks.filter((task) => task.state === 'done' || task.state === 'cancelled').sort(byCompletion);
    const failed = tasks.filter((task) => task.state === 'failed').sort(byCompletion);
    const drop = new Set([
      ...finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED)),
      ...failed.slice(0, Math.max(0, failed.length - KEEP_FAILED)),
    ].map(task => task.id));
    if (drop.size) tasks = tasks.filter(task => !drop.has(task.id));
  };

  return {
    start(title: string, options: { total?: number | null; cancel?: () => void } = {}): TaskHandle {
      const id = nextId++;
      let wasCancelled = false;
      tasks = [...tasks, { id, title, state: 'running', cancellable: typeof options.cancel === 'function', done: 0, total: options.total ?? null, startedAt: now(), updatedAt: now() }];
      if (options.cancel) cancels.set(id, { markCancelled: () => { wasCancelled = true; }, stop: options.cancel });
      emit();
      return {
        id,
        progress: (done, total, detail) => { if (isRunning(id)) update(id, { done, updatedAt: now(), ...(total !== undefined ? { total } : {}), ...(detail !== undefined ? { detail } : {}) }); },
        finish: (detail) => { if (isRunning(id)) { cancels.delete(id); update(id, { state: 'done', endedAt: now(), ...(detail ? { detail } : {}) }); } },
        fail: (message) => { if (isRunning(id)) { cancels.delete(id); update(id, { state: 'failed', endedAt: now(), detail: message }); } },
        get cancelled() { return wasCancelled; },
      };
    },
    /** Stop a running task. Returns false if it was not running or cannot be stopped. */
    cancel(id: number): boolean {
      const stop = cancels.get(id);
      if (!isRunning(id) || !stop) return false;
      cancels.delete(id);
      stop.markCancelled();
      update(id, { state: 'cancelled', endedAt: now() });
      try { stop.stop(); } catch { /* the job is already finishing */ }
      return true;
    },
    /** Hide one completed/failed/cancelled task without touching other failures. */
    dismissFinished(id: number): boolean {
      if (!tasks.some(task => task.id === id && task.state !== 'running')) return false;
      tasks = tasks.filter(task => task.id !== id);
      cancels.delete(id);
      emit();
      return true;
    },
    clearFinished() { tasks = tasks.filter((task) => task.state === 'running'); emit(); },
    list: () => tasks,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

export const tasks = createTaskStore();

/** Successful jobs fade away; failures stay discoverable until explicitly cleared. */
export function tasksNeedAttention(list: readonly Task[], at: number, showAfterMs = 10_000): boolean {
  return list.some(task => task.state === 'running' || task.state === 'failed' ||
    (task.endedAt !== undefined && at - task.endedAt < showAfterMs));
}

export type Health = 'idle' | 'ok' | 'busy' | 'stalled' | 'problem';

const STALLED_MS = 20_000;
const LONG_REMAINING_MS = 60_000;

/**
 * How the workload looks, for the traffic-light button.
 * problem: a task failed. stalled: a running task has not moved for 20 seconds.
 * busy: three or more tasks at once, or one that will take over a minute more. ok: working normally. idle: nothing running.
 */
export function taskHealth(list: Task[], at: number): Health {
  if (list.some((task) => task.state === 'failed')) return 'problem';
  const running = list.filter((task) => task.state === 'running');
  if (!running.length) return 'idle';
  if (running.some((task) => at - task.updatedAt > STALLED_MS)) return 'stalled';
  if (running.length >= 3) return 'busy';
  for (const task of running) {
    if (task.total && task.done > 0) {
      const rate = task.done / Math.max(1, at - task.startedAt);
      if ((task.total - task.done) / rate > LONG_REMAINING_MS) return 'busy';
    }
  }
  return 'ok';
}

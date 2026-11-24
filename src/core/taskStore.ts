/** One observable registry for all engine work, including queued and paused work.
 * Scheduling policy lives in engineScheduler; legacy callers may still start immediately. */
export type TaskState = 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled';
export type TaskLocation = 'local' | 'cloud';
export interface TaskItemInfo {
  id: string;
  label: string;
  state: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  detail?: string;
}
export interface Task {
  id: number;
  title: string;
  state: TaskState;
  cancellable?: boolean;
  pauseable?: boolean;
  done: number;
  total: number | null;
  detail?: string;
  stage?: string;
  location?: TaskLocation;
  priority?: number;
  items?: readonly TaskItemInfo[];
  startedAt: number;
  updatedAt: number;
  endedAt?: number;
}
export interface TaskHandle {
  readonly id: number;
  progress(done: number, total?: number | null, detail?: string): void;
  finish(detail?: string): void;
  fail(message: string): void;
  readonly cancelled: boolean;
  /** Scheduler-only transitions. These never revive a terminal task. */
}
/** Extended handle used by the scheduler; legacy engine stubs only need TaskHandle. */
export interface SchedulerTaskHandle extends TaskHandle {
  transition(state: 'queued' | 'running' | 'paused', detail?: string): void;
  patch(change: Pick<Partial<Task>, 'stage' | 'location' | 'priority' | 'items' | 'pauseable' | 'detail'>): void;
}
const KEEP_FINISHED = 5;
const KEEP_FAILED = 5;

export function createTaskStore(now: () => number = Date.now) {
  let tasks: Task[] = [];
  let nextId = 1;
  const cancels = new Map<number, { markCancelled: () => void; stop: () => void }>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(listener => listener());
  const active = (task: Task | undefined): task is Task => Boolean(task && (task.state === 'queued' || task.state === 'paused' || task.state === 'running'));
  const find = (id: number) => tasks.find(t => t.id === id);
  const trim = () => {
    const byCompletion = (a: Task, b: Task) => (a.endedAt ?? 0) - (b.endedAt ?? 0) || a.id - b.id;
    const finished = tasks.filter(t => t.state === 'done' || t.state === 'cancelled').sort(byCompletion);
    const failed = tasks.filter(t => t.state === 'failed').sort(byCompletion);
    const drop = new Set([
      ...finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED)),
      ...failed.slice(0, Math.max(0, failed.length - KEEP_FAILED)),
    ].map(t => t.id));
    if (drop.size) tasks = tasks.filter(t => !drop.has(t.id));
  };
  const update = (id: number, change: Partial<Task>) => {
    tasks = tasks.map(t => t.id === id ? { ...t, ...change } : t);
    trim();
    emit();
  };
  const register = (title: string, state: 'queued' | 'running', options: {
    total?: number | null; cancel?: () => void; pauseable?: boolean; location?: TaskLocation; priority?: number;
  } = {}): SchedulerTaskHandle => {
    const id = nextId++;
    let wasCancelled = false;
    tasks = [...tasks, {
      id, title, state, done: 0, total: options.total ?? null,
      cancellable: typeof options.cancel === 'function', pauseable: options.pauseable ?? false,
      location: options.location ?? 'local', priority: options.priority ?? 0,
      startedAt: now(), updatedAt: now(),
    }];
    if (options.cancel) cancels.set(id, { markCancelled: () => { wasCancelled = true; }, stop: options.cancel });
    emit();
    return {
      id,
      progress: (done, total, detail) => {
        if (find(id)?.state === 'running') update(id, {
          done, updatedAt: now(), ...(total !== undefined ? { total } : {}),
          ...(detail !== undefined ? { detail } : {}),
        });
      },
      finish: (detail) => {
        if (!active(find(id))) return;
        cancels.delete(id);
        update(id, { state: 'done', endedAt: now(), updatedAt: now(), ...(detail !== undefined ? { detail } : {}) });
      },
      fail: (message) => {
        if (!active(find(id))) return;
        cancels.delete(id);
        update(id, { state: 'failed', endedAt: now(), updatedAt: now(), detail: message });
      },
      transition: (next, detail) => {
        if (!active(find(id))) return;
        update(id, { state: next, updatedAt: now(), ...(detail !== undefined ? { detail } : {}) });
      },
      patch: change => {
        const current = find(id);
        // Cancellation is terminal, but an already-confirmed native save may
        // still report its final child state after its destination responds.
        // Never allow cancelled work to change its stage, status or settings.
        if (active(current)) update(id, { ...change, updatedAt: now() });
        else if (current?.state === 'cancelled' && change.items !== undefined)
          update(id, { items: change.items, updatedAt: now() });
      },
      get cancelled() { return wasCancelled; },
    };
  };
  return {
    start(title: string, options: { total?: number | null; cancel?: () => void; pauseable?: boolean; location?: TaskLocation; priority?: number } = {}): TaskHandle {
      return register(title, 'running', options);
    },
    enqueue(title: string, options: { total?: number | null; cancel?: () => void; pauseable?: boolean; location?: TaskLocation; priority?: number } = {}): SchedulerTaskHandle {
      return register(title, 'queued', options);
    },
    cancel(id: number): boolean {
      const stop = cancels.get(id);
      if (!active(find(id)) || !stop) return false;
      cancels.delete(id);
      stop.markCancelled();
      update(id, { state: 'cancelled', endedAt: now(), updatedAt: now() });
      try { stop.stop(); } catch { /* already ending */ }
      return true;
    },
    dismissFinished(id: number): boolean {
      if (!tasks.some(t => t.id === id && !active(t))) return false;
      tasks = tasks.filter(t => t.id !== id);
      cancels.delete(id);
      emit();
      return true;
    },
    clearFinished() { tasks = tasks.filter(active); emit(); },
    list: () => tasks,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
export const tasks = createTaskStore();

/** A non-terminal queued/paused item must remain visible even if no worker is running. */
export function tasksNeedAttention(list: readonly Task[], at: number, showAfterMs = 10_000): boolean {
  return list.some(t => t.state === 'running' || t.state === 'queued' || t.state === 'paused' || t.state === 'failed' ||
    (t.endedAt !== undefined && at - t.endedAt < showAfterMs));
}
export type Health = 'idle' | 'ok' | 'busy' | 'stalled' | 'problem';
const STALLED_MS = 20_000;
const LONG_REMAINING_MS = 60_000;
export function taskHealth(list: Task[], at: number): Health {
  if (list.some(t => t.state === 'failed')) return 'problem';
  const running = list.filter(t => t.state === 'running');
  if (!running.length) return list.some(t => t.state === 'queued' || t.state === 'paused') ? 'busy' : 'idle';
  if (running.some(t => at - t.updatedAt > STALLED_MS)) return 'stalled';
  if (running.length >= 3 || list.some(t => t.state === 'queued')) return 'busy';
  for (const task of running) {
    if (task.total && task.done > 0) {
      const rate = task.done / Math.max(1, at - task.startedAt);
      if ((task.total - task.done) / rate > LONG_REMAINING_MS) return 'busy';
    }
  }
  return 'ok';
}

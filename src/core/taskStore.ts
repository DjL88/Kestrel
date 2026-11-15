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
  done: number;
  total: number | null;
  detail?: string;
  startedAt: number;
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

export function createTaskStore(now: () => number = Date.now) {
  let tasks: Task[] = [];
  let nextId = 1;
  const cancels = new Map<number, () => void>();
  const cancelledIds = new Set<number>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  const update = (id: number, change: Partial<Task>) => {
    tasks = tasks.map((task) => (task.id === id ? { ...task, ...change } : task));
    emit();
  };
  const isRunning = (id: number) => tasks.find((task) => task.id === id)?.state === 'running';
  const trim = () => {
    const finished = tasks.filter((task) => task.state !== 'running');
    if (finished.length > KEEP_FINISHED) {
      const drop = new Set(finished.slice(0, finished.length - KEEP_FINISHED).map((task) => task.id));
      tasks = tasks.filter((task) => !drop.has(task.id));
    }
  };

  return {
    start(title: string, options: { total?: number | null; cancel?: () => void } = {}): TaskHandle {
      const id = nextId++;
      tasks = [...tasks, { id, title, state: 'running', done: 0, total: options.total ?? null, startedAt: now() }];
      if (options.cancel) cancels.set(id, options.cancel);
      emit();
      return {
        id,
        progress: (done, total, detail) => { if (isRunning(id)) update(id, { done, ...(total !== undefined ? { total } : {}), ...(detail !== undefined ? { detail } : {}) }); },
        finish: (detail) => { if (isRunning(id)) { cancels.delete(id); update(id, { state: 'done', endedAt: now(), ...(detail ? { detail } : {}) }); trim(); } },
        fail: (message) => { if (isRunning(id)) { cancels.delete(id); update(id, { state: 'failed', endedAt: now(), detail: message }); trim(); } },
        get cancelled() { return cancelledIds.has(id); },
      };
    },
    /** Stop a running task. Returns false if it was not running or cannot be stopped. */
    cancel(id: number): boolean {
      const stop = cancels.get(id);
      if (!isRunning(id) || !stop) return false;
      cancelledIds.add(id);
      cancels.delete(id);
      update(id, { state: 'cancelled', endedAt: now() });
      try { stop(); } catch { /* the job is already finishing */ }
      trim();
      return true;
    },
    clearFinished() { tasks = tasks.filter((task) => task.state === 'running'); emit(); },
    list: () => tasks,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

export const tasks = createTaskStore();

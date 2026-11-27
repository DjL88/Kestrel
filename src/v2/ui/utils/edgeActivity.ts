import type { TaskInfo } from '../contract';

/** Work that adds photos to the filmstrip or sorts them: the thin bar along the filmstrip's top edge shows only this. */
const FILMSTRIP_KINDS = new Set(['import', 'thumbnail', 'cull', 'detect']);

export interface EdgeActivity {
  /** What is happening, in the person's words (the running task's own title). */
  label: string;
  /** 0 to 100 when the amount is known; null while it is not (an indeterminate bar, never a made-up number). */
  value: number | null;
  /** Photos (or steps) done and to do across this work, when every part of it knows its size. */
  done: number | null;
  total: number | null;
  /** A rough time left, only once there is enough real progress to measure a rate; null: not known yet. */
  remainingMs: number | null;
}

const isActive = (task: TaskInfo) => task.status === 'running' || task.status === 'queued' || task.status === 'paused';

/** Done and total across tasks, or null when any of them does not know its size. */
export function countAcross(tasks: readonly TaskInfo[]): { done: number; total: number } | null {
  if (!tasks.length || !tasks.every((task) => typeof task.total === 'number' && task.total > 0)) return null;
  const total = tasks.reduce((sum, task) => sum + (task.total ?? 0), 0);
  const done = tasks.reduce((sum, task) => sum + Math.min(task.done ?? 0, task.total ?? 0), 0);
  return { done, total };
}

/** A rough time left from the measured rate so far. Unknown stays unknown: too few photos done, or too little time
 * passed, gives null rather than a guess. */
export function roughRemainingMs(done: number, total: number, startedAt: number | undefined, now: number): number | null {
  if (startedAt === undefined || done < 3 || done >= total) return null;
  const elapsed = now - startedAt;
  if (elapsed < 10_000) return null;
  return ((total - done) * elapsed) / done;
}

/** The filmstrip's import and sorting work as one bar, or null when there is none. Queued and paused work counts as
 * still to do, so the bar does not flicker off between an import and the Auto-pilot cull that follows it. */
export function filmstripActivity(tasks: readonly TaskInfo[], now = Date.now()): EdgeActivity | null {
  const active = tasks.filter((task) => task.kind && FILMSTRIP_KINDS.has(task.kind) && isActive(task));
  if (!active.length) return null;
  const shown = active.find((task) => task.status === 'running') ?? active[0];
  const counted = countAcross(active);
  if (!counted) return { label: shown.label, value: null, done: null, total: null, remainingMs: null };
  const started = active.map((task) => task.startedAt).filter((at): at is number => typeof at === 'number');
  // The count beside the label is that task's own ("Adding 2050 photos": 0 to 2,050). The bar and the time left span
  // all of this work; summing the counts put the import's thumbnails on top (it counted to 2,051).
  const own = typeof shown.total === 'number' && shown.total > 0 ? { done: Math.min(shown.done ?? 0, shown.total), total: shown.total } : counted;
  return {
    label: shown.label,
    value: Math.min(100, Math.round((counted.done / counted.total) * 100)),
    done: own.done,
    total: own.total,
    remainingMs: roughRemainingMs(counted.done, counted.total, started.length ? Math.min(...started) : undefined, now),
  };
}

/** The Tasks wheel: every running task's share done, by the photos (or steps) it counts, not by how many tasks run. */
export function tasksWheelProgress(tasks: readonly TaskInfo[]): { running: number; percent: number; done: number | null; total: number | null } {
  const running = tasks.filter((task) => task.status === 'running');
  if (!running.length) return { running: 0, percent: 0, done: null, total: null };
  const counted = countAcross(running);
  if (counted) return { running: running.length, percent: Math.round((counted.done / counted.total) * 100), ...counted };
  return { running: running.length, percent: Math.round(running.reduce((sum, task) => sum + task.progress, 0) / running.length), done: null, total: null };
}

/** Minutes left, rounded up, for the "time for a cup of tea" note; null under a minute or when not known. */
export function minutesLeft(remainingMs: number | null): number | null {
  if (remainingMs === null || remainingMs < 60_000) return null;
  return Math.ceil(remainingMs / 60_000);
}

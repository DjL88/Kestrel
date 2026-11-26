import type { TaskInfo } from '../contract';

/** Work that adds photos to the filmstrip or sorts them: the thin bar along the filmstrip's top edge shows only this. */
const FILMSTRIP_KINDS = new Set(['import', 'thumbnail', 'cull', 'detect']);

export interface EdgeActivity {
  /** What is happening, in the person's words (the task's own title and count). */
  label: string;
  /** 0 to 100 when the amount is known; null while it is not (an indeterminate bar, never a made-up number). */
  value: number | null;
}

/** The filmstrip's import and sorting work as one bar, or null when there is none. Queued and paused work counts as
 * still to do, so the bar does not flicker off between an import and the Auto-pilot cull that follows it. */
export function filmstripActivity(tasks: readonly TaskInfo[]): EdgeActivity | null {
  const active = tasks.filter((task) => task.kind && FILMSTRIP_KINDS.has(task.kind)
    && (task.status === 'running' || task.status === 'queued' || task.status === 'paused'));
  if (!active.length) return null;
  const shown = active.find((task) => task.status === 'running') ?? active[0];
  const label = shown.detail ? `${shown.label}: ${shown.detail}` : shown.label;
  const known = active.every((task) => typeof task.total === 'number' && task.total > 0);
  if (!known) return { label, value: null };
  const total = active.reduce((sum, task) => sum + (task.total ?? 0), 0);
  const done = active.reduce((sum, task) => sum + Math.min(task.done ?? 0, task.total ?? 0), 0);
  return { label, value: Math.min(100, Math.round((done / total) * 100)) };
}

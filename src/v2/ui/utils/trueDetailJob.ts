import type { TaskInfo } from '../contract';

/** This photo's TrueDetail (denoise) job, while it waits or runs, so the Enhance panel can show it where it was asked for. */
export interface TrueDetailJob { state: 'queued' | 'running'; percent: number }

export function trueDetailJob(tasks: readonly TaskInfo[], photoId: string | undefined): TrueDetailJob | null {
  if (!photoId) return null;
  const task = tasks.find((candidate) => candidate.kind === 'denoise'
    && (candidate.status === 'queued' || candidate.status === 'running')
    && (candidate.items ?? []).some((item) => item.id === photoId));
  if (!task) return null;
  return { state: task.status === 'running' ? 'running' : 'queued', percent: Math.max(0, Math.min(100, Math.round(task.progress))) };
}

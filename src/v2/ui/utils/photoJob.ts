import type { TaskInfo } from '../contract';

/** Whether a job of this kind is waiting or running for this photo (for example finding its subject for a mask). */
export function photoJobActive(tasks: readonly TaskInfo[], kind: TaskInfo['kind'], photoId: string | undefined): boolean {
  if (!photoId) return false;
  return tasks.some((task) => task.kind === kind && (task.status === 'queued' || task.status === 'running')
    && (task.items ?? []).some((item) => item.id === photoId));
}

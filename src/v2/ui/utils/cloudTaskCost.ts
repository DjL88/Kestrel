import { estimateCloudTask, formatPence, type CloudUsage } from '../../../core/cloudPlan';
import type { TaskInfo } from '../contract';
import { STRINGS } from '../strings';

/**
 * The Task Manager's line for a cloud task that is still to run: allowance photos first, then the cloud balance, else
 * it runs on this device. Null for device tasks, finished tasks, unknown totals, or when not signed in.
 */
export function cloudTaskCost(task: Pick<TaskInfo, 'location' | 'status' | 'total' | 'done'>, usage: CloudUsage | undefined): string | null {
  if (!usage || task.location !== 'cloud' || !task.total) return null;
  if (task.status !== 'queued' && task.status !== 'running' && task.status !== 'paused') return null;
  const left = Math.max(0, task.total - (task.done ?? 0));
  if (left === 0) return null;
  const e = estimateCloudTask(left, usage);
  const words = STRINGS.cloudUsage;
  if (!e.canRunInCloud) return words.taskOnDevice;
  if (e.paidPhotos > 0) return words.taskPays(e.paidPhotos.toLocaleString('en-GB'), formatPence(e.pence));
  return words.taskUses(e.fromAllowance.toLocaleString('en-GB'), e.allowanceLeftAfter.toLocaleString('en-GB'));
}

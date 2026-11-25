/**
 * Task-done alerts (G20, owner decision 11): tell the person when long work they started has finished, without
 * spamming them. Pure and offline: it reads the task list (src/core/taskStore.ts), never the network.
 *
 * - Only long work: a task that ran for at least `minDurationMs` (20 s by default). Quick work needs no alert.
 * - One alert per batch, never per photo: tasks that end close together are told in one message.
 * - Cancelled by the person: no alert (they know). Failed: always said, in words, so it is never missed.
 * - Where it shows is the caller's choice: a system notification while the window is in the background (only if the
 *   person allowed it), otherwise a calm in-app message when they come back. In-app is always the fallback.
 */
import type { Task } from './taskStore';

export const TASK_ALERT_MIN_MS = 20_000;
export const TASK_ALERT_GROUP_MS = 4_000;

export interface FinishedTask { id: number; title: string; state: 'done' | 'failed'; done: number; total: number | null; detail?: string; ranMs: number; endedAt: number }

const terminal = (t: Task) => t.state === 'done' || t.state === 'failed' || t.state === 'cancelled';

/**
 * Tasks that reached done or failed since the last look, and ran long enough to be worth telling. `seen` holds the
 * ids already reported or already finished when watching began, so nothing is told twice.
 */
export function newlyFinished(list: readonly Task[], seen: Set<number>, minDurationMs = TASK_ALERT_MIN_MS): FinishedTask[] {
  const out: FinishedTask[] = [];
  for (const t of list) {
    if (!terminal(t) || seen.has(t.id)) continue;
    seen.add(t.id);
    if (t.state === 'cancelled') continue;
    const endedAt = t.endedAt ?? t.updatedAt;
    const ranMs = Math.max(0, endedAt - t.startedAt);
    if (t.state === 'done' && ranMs < minDurationMs) continue;
    out.push({ id: t.id, title: t.title, state: t.state === 'failed' ? 'failed' : 'done', done: t.done, total: t.total, detail: t.detail, ranMs, endedAt });
  }
  return out.sort((a, b) => a.endedAt - b.endedAt || a.id - b.id);
}

/** Ids of everything already finished, so watching starts quiet (no alerts for work that ended before). */
export function alreadyFinished(list: readonly Task[]): Set<number> {
  return new Set(list.filter(terminal).map((t) => t.id));
}

export interface TaskAlert { failed: number; finished: FinishedTask[] }

/** Groups tasks that ended within `groupMs` of each other into one alert each. */
export function groupAlerts(finished: readonly FinishedTask[], groupMs = TASK_ALERT_GROUP_MS): TaskAlert[] {
  const alerts: TaskAlert[] = [];
  let current: FinishedTask[] = [];
  for (const task of finished) {
    if (current.length && task.endedAt - current[current.length - 1].endedAt > groupMs) { alerts.push(close(current)); current = []; }
    current.push(task);
  }
  if (current.length) alerts.push(close(current));
  return alerts;
}
const close = (finished: FinishedTask[]): TaskAlert => ({ failed: finished.filter((t) => t.state === 'failed').length, finished });

/** The words, from the caller's dictionary. A single task names itself; several are counted. */
export function alertText(alert: TaskAlert, words: {
  oneDone: (title: string) => string; oneFailed: (title: string) => string;
  manyDone: (n: number) => string; manyWithFailures: (n: number, failed: number) => string;
}): string {
  if (alert.finished.length === 1) {
    const [task] = alert.finished;
    return task.state === 'failed' ? words.oneFailed(task.title) : words.oneDone(task.title);
  }
  return alert.failed ? words.manyWithFailures(alert.finished.length, alert.failed) : words.manyDone(alert.finished.length);
}

/**
 * While the window is in the background, alerts are held. On return they are told once, together:
 * "While you were away: …". Returns what to show now and what to keep holding.
 */
export function releaseHeld(held: readonly TaskAlert[], visible: boolean): { show: TaskAlert | null; keep: TaskAlert[] } {
  if (!visible || held.length === 0) return { show: null, keep: [...held] };
  const finished = held.flatMap((a) => a.finished);
  return { show: { failed: finished.filter((t) => t.state === 'failed').length, finished }, keep: [] };
}

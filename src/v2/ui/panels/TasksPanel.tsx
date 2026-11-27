import React, { useEffect, useReducer, useRef, useState } from 'react';
import type { TaskInfo } from '../contract';
import { STRINGS } from '../strings';
import type { CloudUsage } from '../../../core/cloudPlan';
import { cloudTaskCost } from '../utils/cloudTaskCost';
import BrandIcon from '../icons/BrandIcon';
import { taskDuration } from '../utils/taskDuration';
import { engineScheduler } from '../../../core/engineScheduler';
import { moveQueuedTask, placeSubset, stableTaskOrder } from '../utils/queuedTaskOrder';

interface TasksPanelProps {
  tasks: TaskInfo[];
  onCancelTask: (taskId: string) => void;
  onClearTask: (taskId: string) => void;
  onClearCompleted: () => void;
  /** This month's cloud allowance and balance, when signed in: cloud tasks then say what they will use. */
  cloudUsage?: CloudUsage;
}
const active = (status: TaskInfo['status']) => status === 'running' || status === 'queued' || status === 'paused';
const stateLabel = (status: TaskInfo['status']) => STRINGS.taskControls.states[status];
const duration = taskDuration;
function timing(task: TaskInfo, clock: number) {
  if (!task.startedAt) return null;
  const elapsed = Math.max(0, (task.endedAt ?? clock) - task.startedAt);
  if (task.status !== 'running' || !task.total || !task.done || task.done < 3) return STRINGS.taskControls.elapsed(duration(elapsed));
  const remaining = Math.round((elapsed / task.done) * (task.total - task.done));
  return STRINGS.taskControls.elapsedRemaining(duration(elapsed), duration(remaining));
}

const controlStyle = 'inline-flex min-h-11 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface-active)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40';
export default function TasksPanel({ tasks, onCancelTask, onClearTask, onClearCompleted, cloudUsage }: TasksPanelProps) {
  const [tab, setTab] = useState<'active' | 'completed'>('active');
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    if (!tasks.some(task => task.status === 'running')) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [tasks]);
  // Rows keep their place while they wait, run, pause and finish; only the person moves them.
  // A task that finishes while this list is open stays in its row (marked done) until the
  // person switches tab or closes Tasks, so nothing shifts under the pointer or focus.
  const orderRef = useRef<string[]>([]);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const running = tasks.filter(task => active(task.status));
  const settled = new Set(orderRef.current);
  const activePool = tasks.filter(task => active(task.status) || settled.has(task.id));
  orderRef.current = stableTaskOrder(orderRef.current, activePool);
  const byId = new Map(activePool.map(task => [task.id, task]));
  const activeRows = orderRef.current.map(id => byId.get(id)).filter((task): task is TaskInfo => Boolean(task));
  const queuedOrder = activeRows.filter(task => task.status === 'queued').map(task => Number(task.id));
  const applyQueueOrder = (next: number[]) => {
    orderRef.current = placeSubset(orderRef.current, next.map(String));
    engineScheduler.reorder(next);
    rerender();
  };
  const jump = (taskId: number) => {
    if (queuedOrder.includes(taskId)) orderRef.current = placeSubset(orderRef.current, [taskId, ...queuedOrder.filter(id => id !== taskId)].map(String));
    engineScheduler.jumpQueue(taskId);
    rerender();
  };
  const chooseTab = (id: 'active' | 'completed') => {
    orderRef.current = orderRef.current.filter(taskId => running.some(task => task.id === taskId));
    setTab(id);
  };
  const finished = tasks.filter(task => !active(task.status));
  const shown = tab === 'active' ? activeRows : finished;
  const allPaused = engineScheduler.isPausedAll();
  const canPauseAny = !allPaused && running.some(task => task.status === 'queued' || (task.pauseable && task.status === 'running'));

  const tabButton = (id: 'active' | 'completed', label: string, count: number) => (
    <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => chooseTab(id)}
      className={`min-h-11 flex-1 rounded-[var(--radius-sm)] px-2 text-xs font-medium ${tab === id ? 'bg-[var(--bg-surface-active)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
      {label} ({count})
    </button>
  );

  return (
    <section aria-label={STRINGS.taskControls.sectionLabel} className="space-y-3">
      <div role="tablist" aria-label={STRINGS.tasks.heading} className="flex gap-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-0.5">
        {tabButton('active', STRINGS.tasks.tabActive, running.length)}
        {tabButton('completed', STRINGS.tasks.tabCompleted, finished.length)}
      </div>
      {tab === 'active' && (running.length > 0 || allPaused) && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={controlStyle} disabled={!canPauseAny}
            onClick={() => engineScheduler.pauseAll()}>{STRINGS.taskControls.pauseAll}</button>
          <button type="button" className={controlStyle}
            disabled={!running.some(task => task.status === 'paused') && !allPaused}
            onClick={() => engineScheduler.resumeAll()}>{STRINGS.taskControls.resumeAll}</button>
        </div>
      )}
      {tab === 'completed' && finished.length > 0 && (
        <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
          <span>{STRINGS.tasks.keepNote}</span>
          <button type="button" onClick={onClearCompleted} className={controlStyle}>{STRINGS.tasks.deleteAll}</button>
        </div>
      )}
      {shown.length === 0 ? (
        <p className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-4 text-center text-xs text-[var(--text-secondary)]">
          {tab === 'active' ? STRINGS.tasks.empty : STRINGS.tasks.emptyCompleted}
        </p>
      ) : shown.map(task => {
        const taskId = Number(task.id);
        const canRetry = task.status === 'failed' && engineScheduler.canRetryFailed(taskId);
        const canPause = Boolean(task.pauseable && (task.status === 'running' || task.status === 'queued'));
        const canResume = Boolean(task.pauseable && task.status === 'paused');
        const canPrioritise = task.status === 'queued' || task.status === 'running';
        // Waiting for the computer's capacity: the person may start it anyway.
        const canStartNow = task.status === 'queued' && engineScheduler.isWaitingForCapacity(taskId);
        const seconds = timing(task, clock);
        const queueIndex = queuedOrder.indexOf(taskId);
        return (
          <article key={task.id} data-testid="task-row" data-task-id={task.id} className="space-y-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="break-words text-xs font-semibold text-[var(--text-primary)]">{task.label}</p>
                <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{stateLabel(task.status)} · {task.location === 'cloud' ? STRINGS.taskControls.cloud : STRINGS.taskControls.onDevice}</p>
              </div>
              <span className="font-mono text-xs tabular-nums text-[var(--text-primary)]">{task.progress}%</span>
            </div>
            {/* While it runs, a light sweeps along the bar so a long task never looks frozen (still with less movement). */}
            <div className={`relative overflow-hidden rounded-full${task.status === 'running' ? ' v2-task-progress-running' : ''}`} data-testid="task-progress">
              <progress aria-label={STRINGS.taskControls.progressLabel(task.label)} max={100} value={task.progress} className="block h-2 w-full" />
            </div>
            {task.total !== undefined && task.total !== null && (
              <p className="text-xs text-[var(--text-secondary)]">{STRINGS.taskControls.processed(task.done ?? 0, task.total)}</p>
            )}
            {task.stage && <p className="break-words text-xs text-[var(--text-secondary)]">{STRINGS.taskControls.stage(task.stage)}</p>}
            {(() => { const cost = cloudTaskCost(task, cloudUsage); return cost && <p data-testid="task-cloud-cost" className="break-words text-xs text-[var(--text-secondary)]">{cost}</p>; })()}
            {task.detail && <p role={task.status === 'failed' ? 'alert' : undefined} className="break-words text-xs text-[var(--text-secondary)]">{task.detail}</p>}
            {seconds && <p className="text-xs tabular-nums text-[var(--text-muted)]">{seconds}</p>}
            {task.items && task.items.length > 0 && (
              <details className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] p-2">
                <summary className="min-h-11 cursor-pointer py-3 text-xs font-medium text-[var(--text-primary)]">
                  {STRINGS.taskControls.showItems(task.items.length)}
                </summary>
                <ul className="max-h-64 space-y-1 overflow-y-auto" aria-label={STRINGS.taskControls.itemsLabel}>
                  {task.items.map(item => (
                    <li key={item.id} className="flex flex-wrap justify-between gap-2 border-t border-[var(--border-subtle)] py-2 text-xs">
                      <span className="min-w-0 break-all text-[var(--text-primary)]">{item.label}</span>
                      <span className="text-[var(--text-secondary)]">{stateLabel(item.state)}</span>
                      {item.detail && <span className="w-full break-words text-[var(--text-secondary)]">{item.detail}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {canPause && <button type="button" onClick={() => engineScheduler.pause(taskId)}
                className={controlStyle} aria-label={STRINGS.taskControls.pauseLabel(task.label)}>{STRINGS.taskControls.pause}</button>}
              {canResume && <button type="button" onClick={() => engineScheduler.resume(taskId)}
                className={controlStyle} aria-label={STRINGS.taskControls.resumeLabel(task.label)}>{STRINGS.taskControls.resume}</button>}
              {canStartNow && <button type="button" onClick={() => engineScheduler.startNow(taskId)} data-testid="task-start-now"
                className={controlStyle} aria-label={STRINGS.taskControls.startNowLabel(task.label)}>{STRINGS.taskControls.startNow}</button>}
              {canPrioritise && task.pauseable && <button type="button" onClick={() => jump(taskId)}
                className={controlStyle} aria-label={STRINGS.taskControls.jumpLabel(task.label)}>{STRINGS.taskControls.jumpQueue}</button>}
              {queueIndex > 0 && <button type="button" onClick={() => applyQueueOrder(moveQueuedTask(queuedOrder, taskId, -1))}
                className={controlStyle} aria-label={STRINGS.taskControls.upLabel(task.label)}>{STRINGS.taskControls.moveUp}</button>}
              {queueIndex >= 0 && queueIndex < queuedOrder.length - 1 && <button type="button" onClick={() => applyQueueOrder(moveQueuedTask(queuedOrder, taskId, 1))}
                className={controlStyle} aria-label={STRINGS.taskControls.downLabel(task.label)}>{STRINGS.taskControls.moveDown}</button>}
              {active(task.status) && task.cancellable !== false && (
                <button type="button" onClick={() => onCancelTask(task.id)} className={controlStyle}
                  aria-label={STRINGS.taskControls.cancelLabel(task.label)}>{STRINGS.tasks.cancel}</button>
              )}
              {canRetry && <button type="button" onClick={() => { void engineScheduler.retryFailed(taskId); }}
                className={controlStyle} aria-label={STRINGS.taskControls.retryLabel(task.label)}>{STRINGS.taskControls.retryFailed}</button>}
              {!active(task.status) && <button type="button" onClick={() => onClearTask(task.id)} className={controlStyle}
                aria-label={STRINGS.taskControls.clearLabel(task.label)}>{STRINGS.tasks.deleteOne}</button>}
            </div>
          </article>
        );
      })}
    </section>
  );
}

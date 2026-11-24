import React, { useEffect, useState } from 'react';
import type { TaskInfo } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon from '../icons/BrandIcon';
import { engineScheduler } from '../../../core/engineScheduler';

interface TasksPanelProps {
  tasks: TaskInfo[];
  onCancelTask: (taskId: string) => void;
  onClearTask: (taskId: string) => void;
  onClearCompleted: () => void;
}
const active = (status: TaskInfo['status']) => status === 'running' || status === 'queued' || status === 'paused';
const stateLabel = (status: TaskInfo['status']) => ({
  running: 'Running', queued: 'Queued', paused: 'Paused', done: 'Completed',
  cancelled: 'Cancelled', failed: 'Failed',
})[status];
const duration = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};
function timing(task: TaskInfo, clock: number) {
  if (!task.startedAt) return null;
  const elapsed = Math.max(0, (task.endedAt ?? clock) - task.startedAt);
  if (task.status !== 'running' || !task.total || !task.done || task.done < 3) return `Elapsed ${duration(elapsed)}`;
  const remaining = Math.round((elapsed / task.done) * (task.total - task.done));
  return `Elapsed ${duration(elapsed)} · approximately ${duration(remaining)} remaining`;
}

const controlStyle = 'inline-flex min-h-11 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface-active)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40';
export default function TasksPanel({ tasks, onCancelTask, onClearTask, onClearCompleted }: TasksPanelProps) {
  const [tab, setTab] = useState<'active' | 'completed'>('active');
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    if (!tasks.some(task => task.status === 'running')) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [tasks]);
  const running = tasks.filter(task => active(task.status));
  const finished = tasks.filter(task => !active(task.status));
  const shown = tab === 'active' ? running : finished;
  const canPauseAny = running.some(task => task.pauseable && task.status !== 'paused');

  const tabButton = (id: 'active' | 'completed', label: string, count: number) => (
    <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
      className={`min-h-11 flex-1 rounded-[var(--radius-sm)] px-2 text-xs font-medium ${tab === id ? 'bg-[var(--bg-surface-active)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
      {label} ({count})
    </button>
  );

  return (
    <section aria-label="Processing tasks" className="space-y-3">
      <div role="tablist" aria-label={STRINGS.tasks.heading} className="flex gap-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-0.5">
        {tabButton('active', STRINGS.tasks.tabActive, running.length)}
        {tabButton('completed', STRINGS.tasks.tabCompleted, finished.length)}
      </div>
      {tab === 'active' && running.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={controlStyle} disabled={!canPauseAny}
            onClick={() => engineScheduler.pauseAll()}>Pause all</button>
          <button type="button" className={controlStyle}
            disabled={!running.some(task => task.status === 'paused') && !engineScheduler.isPausedAll()}
            onClick={() => engineScheduler.resumeAll()}>Resume all</button>
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
        const seconds = timing(task, clock);
        return (
          <article key={task.id} className="space-y-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="break-words text-xs font-semibold text-[var(--text-primary)]">{task.label}</p>
                <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{stateLabel(task.status)} · {task.location === 'cloud' ? 'Cloud' : 'On this device'}</p>
              </div>
              <span className="font-mono text-xs tabular-nums text-[var(--text-primary)]">{task.progress}%</span>
            </div>
            <progress aria-label={`${task.label} progress`} max={100} value={task.progress} className="block h-2 w-full" />
            {task.total !== undefined && task.total !== null && (
              <p className="text-xs text-[var(--text-secondary)]">{task.done ?? 0} of {task.total} photographs or outputs processed</p>
            )}
            {task.stage && <p className="break-words text-xs text-[var(--text-secondary)]">Stage: {task.stage}</p>}
            {task.detail && <p role={task.status === 'failed' ? 'alert' : undefined} className="break-words text-xs text-[var(--text-secondary)]">{task.detail}</p>}
            {seconds && <p className="text-xs tabular-nums text-[var(--text-muted)]">{seconds}</p>}
            {task.items && task.items.length > 0 && (
              <details className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] p-2">
                <summary className="min-h-11 cursor-pointer py-3 text-xs font-medium text-[var(--text-primary)]">
                  Show {task.items.length} individual photographs or outputs
                </summary>
                <ul className="max-h-64 space-y-1 overflow-y-auto" aria-label="Individual processing items">
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
                className={controlStyle} aria-label={`Pause ${task.label}`}>Pause</button>}
              {canResume && <button type="button" onClick={() => engineScheduler.resume(taskId)}
                className={controlStyle} aria-label={`Resume ${task.label}`}>Resume</button>}
              {canPrioritise && task.pauseable && <button type="button" onClick={() => engineScheduler.jumpQueue(taskId)}
                className={controlStyle} aria-label={`Move ${task.label} to the front of the queue`}>Jump the queue</button>}
              {active(task.status) && task.cancellable !== false && (
                <button type="button" onClick={() => onCancelTask(task.id)} className={controlStyle}
                  aria-label={`Cancel ${task.label}`}>{STRINGS.tasks.cancel}</button>
              )}
              {canRetry && <button type="button" onClick={() => { void engineScheduler.retryFailed(taskId); }}
                className={controlStyle} aria-label={`Retry failed items in ${task.label}`}>Retry failed</button>}
              {!active(task.status) && <button type="button" onClick={() => onClearTask(task.id)} className={controlStyle}
                aria-label={`Clear ${task.label}`}>{STRINGS.tasks.deleteOne}</button>}
            </div>
          </article>
        );
      })}
    </section>
  );
}

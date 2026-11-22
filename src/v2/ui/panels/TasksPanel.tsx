import React, { useState } from 'react';
import type { TaskInfo } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon from '../icons/BrandIcon';

interface TasksPanelProps {
  tasks: TaskInfo[];
  onCancelTask: (taskId: string) => void;
  onClearTask: (taskId: string) => void;
  onClearCompleted: () => void;
}

export default function TasksPanel({ tasks, onCancelTask, onClearTask, onClearCompleted }: TasksPanelProps) {
  const [tab, setTab] = useState<'active' | 'completed'>('active');
  const running = tasks.filter((task) => task.status === 'running');
  const finished = tasks.filter((task) => task.status !== 'running');
  const shown = tab === 'active' ? running : finished;
  const tabButton = (id: 'active' | 'completed', label: string, count: number) => (
    <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
      className={`flex-1 rounded-[var(--radius-sm)] px-2 py-1.5 text-xs font-medium ${tab === id ? 'bg-[var(--bg-surface-active)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
      {label} ({count})
    </button>
  );
  const tabs = (
    <div role="tablist" aria-label={STRINGS.tasks.heading} className="mb-2.5 flex gap-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-0.5">
      {tabButton('active', STRINGS.tasks.tabActive, running.length)}
      {tabButton('completed', STRINGS.tasks.tabCompleted, finished.length)}
    </div>
  );
  if (shown.length === 0) {
    return (
      <div>
        {tabs}
        <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-4 text-center text-xs text-[var(--text-secondary)]">
          {tab === 'active' ? STRINGS.tasks.empty : STRINGS.tasks.emptyCompleted}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {tabs}
      {tab === 'completed' && (
        <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--text-secondary)]">
          <span>{STRINGS.tasks.keepNote}</span>
          <button type="button" onClick={onClearCompleted} className="shrink-0 rounded-[var(--radius-xs)] border border-[var(--border-default)] px-2 py-0.5 font-medium hover:border-[var(--semantic-danger)]">{STRINGS.tasks.deleteAll}</button>
        </div>
      )}
      {shown.map((task) => (
        <div
          key={task.id}
          className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3 space-y-2"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[var(--text-primary)]">{task.label}</p>
              <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">{task.detail}</p>
            </div>
            {task.status === 'running' && (
              <button
                type="button"
                onClick={() => onCancelTask(task.id)}
                className="shrink-0 rounded-[var(--radius-xs)] border border-[var(--border-default)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)] hover:border-[var(--semantic-danger)] hover:text-[var(--semantic-danger)]"
              >
                {STRINGS.tasks.cancel}
              </button>
            )}
            {task.status !== 'running' && (
              <button
                type="button"
                onClick={() => onClearTask(task.id)}
                className="shrink-0 rounded-[var(--radius-xs)] border border-[var(--border-default)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)] hover:border-[var(--semantic-danger)] hover:text-[var(--semantic-danger)]"
              >
                {STRINGS.tasks.deleteOne}
              </button>
            )}
          </div>

          <div className="space-y-1">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-surface-active)]">
              <div
                className={`h-full rounded-full transition-all duration-200 ${
                  task.status === 'done'
                    ? 'bg-[var(--semantic-success)]'
                    : task.status === 'cancelled'
                    ? 'bg-[var(--text-muted)]'
                    : task.status === 'failed'
                    ? 'bg-[var(--semantic-danger)]'
                    : 'bg-[var(--brand-accent)]'
                }`}
                style={{ width: `${task.progress}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
              <span className="flex items-center gap-1">
                <BrandIcon
                  name={task.status === 'done' ? 'ready' : task.status === 'cancelled' || task.status === 'failed' ? 'close' : 'loader'}
                  size={11}
                  className={
                    task.status === 'done'
                      ? 'text-[var(--semantic-success)]'
                      : task.status === 'running'
                      ? 'text-[var(--brand-accent)]'
                      : ''
                  }
                />
                <span>
                  {task.status === 'running'
                    ? STRINGS.tasks.statusRunning
                    : task.status === 'done'
                    ? STRINGS.tasks.statusDone
                    : task.status === 'failed'
                    ? STRINGS.tasks.statusFailed
                    : STRINGS.tasks.statusCancelled}
                </span>
              </span>
              <span className="font-mono tabular-nums">{task.progress}%</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

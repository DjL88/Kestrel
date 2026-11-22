import React from 'react';
import type { TaskInfo } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon from '../icons/BrandIcon';

interface TasksPanelProps {
  tasks: TaskInfo[];
  onCancelTask: (taskId: string) => void;
}

export default function TasksPanel({ tasks, onCancelTask }: TasksPanelProps) {
  if (tasks.length === 0) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-4 text-center text-xs text-[var(--text-muted)]">
        {STRINGS.tasks.empty}
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {tasks.map((task) => (
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
          </div>

          <div className="space-y-1">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-surface-active)]">
              <div
                className={`h-full rounded-full transition-all duration-200 ${
                  task.status === 'done'
                    ? 'bg-[var(--semantic-success)]'
                    : task.status === 'cancelled'
                    ? 'bg-[var(--text-muted)]'
                    : 'bg-[var(--brand-accent)]'
                }`}
                style={{ width: `${task.progress}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
              <span className="flex items-center gap-1">
                <BrandIcon
                  name={task.status === 'done' ? 'ready' : task.status === 'cancelled' ? 'close' : 'loader'}
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

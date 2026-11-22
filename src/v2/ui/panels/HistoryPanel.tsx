import React from 'react';
import type { Photo } from '../contract';
import { STRINGS } from '../strings';

interface HistoryPanelProps {
  photo: Photo | null;
  onJumpToStep: (photoId: string, cursor: number) => void;
}

function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/**
 * The photo's edit steps, oldest first, from the real history. Choosing a step restores the photo to how it was then; the later
 * steps stay in the list so the choice can always be undone by choosing the last step again (or with Redo).
 */
export default function HistoryPanel({ photo, onJumpToStep }: HistoryPanelProps) {
  if (!photo) return <p className="text-xs text-[var(--text-muted)]">{STRINGS.history.noPhoto}</p>;
  const history = photo.editHistory;
  if (!history) return <p className="text-xs leading-relaxed text-[var(--text-secondary)]">{STRINGS.history.empty}</p>;
  const rows = [{ label: STRINGS.history.original, at: undefined as number | undefined }, ...history.steps];
  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-[var(--text-secondary)]">{STRINGS.history.intro}</p>
      <ol aria-label={STRINGS.history.heading} className="space-y-1.5">
        {rows.map((row, cursor) => {
          const current = cursor === history.cursor;
          const later = cursor > history.cursor;
          return (
            <li key={cursor}>
              <button
                type="button"
                aria-current={current ? 'step' : undefined}
                onClick={() => onJumpToStep(photo.id, cursor)}
                className={`flex min-h-10 w-full items-center justify-between gap-3 rounded-[var(--radius-sm)] border px-3 text-left text-xs ${
                  current
                    ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--text-primary)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-input)] hover:border-[var(--border-default)]'
                } ${later ? 'text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}
              >
                <span className="font-medium">
                  {row.label}
                  {current ? ` · ${STRINGS.history.now}` : later ? ` · ${STRINGS.history.undone}` : ''}
                </span>
                {row.at !== undefined && <span className="font-mono text-[10px] text-[var(--text-muted)]">{timeOf(row.at)}</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

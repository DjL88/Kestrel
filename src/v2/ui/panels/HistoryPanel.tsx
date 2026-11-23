import React from 'react';
import type { Photo } from '../contract';
import { STRINGS } from '../strings';

interface HistoryPanelProps {
  photo: Photo | null;
  activeSizeId: string;
  onJumpToStep: (photoId: string, cursor: number) => void;
}

const FORMAT_EVENTS: Record<string, string> = {
  created: 'Format created', crop: 'Crop / framing adjusted',
  hidden: 'Format hidden', shown: 'Format shown', removed: 'Format removed',
  linked: 'Linked to shared edits', unlinked: 'Unlinked from shared edits',
  size: 'Canvas dimensions changed',
};

function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Real, recorded activity only. Photo-wide edits are the shared recipe and
 * remain interactive; per-format activity is separate and currently read-only.
 * We do not show old photos as if they were historical render snapshots.
 */
export default function HistoryPanel({ photo, activeSizeId, onJumpToStep }: HistoryPanelProps) {
  if (!photo) return <p className="text-xs text-[var(--text-muted)]">{STRINGS.history.noPhoto}</p>;
  const format = photo.sizes.find(s => s.id === activeSizeId);
  const events = photo.formatHistory?.filter(e => e.formatId === activeSizeId) ?? [];
  const ordered = [...events].sort((a, b) => a.at - b.at);
  const history = photo.editHistory;
  const rows = history ? [{ label: STRINGS.history.original, at: undefined as number | undefined }, ...history.steps] : [];

  return (
    <div className="space-y-5">
      <section className="space-y-2" aria-label="This format's history">
        <h3 className="text-xs font-semibold text-[var(--text-primary)]">
          {format?.label ?? 'Selected format'} — format history
        </h3>
        <p className="text-[11px] text-[var(--text-secondary)]">
          {activeSizeId === 'orig-3x2'
            ? 'Original is the permanent starting branch. It can be hidden but not deleted.'
            : 'This format keeps its own crop and layout history. Linked edits are shared with the photograph.'}
        </p>
        <ol className="space-y-1.5" aria-label="Recorded format actions">
          {activeSizeId === 'orig-3x2' && (
            <li className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2 text-xs">
              Original — imported photograph
            </li>
          )}
          {ordered.map((event, i) => (
            <li key={`${event.at}-${event.kind}-${i}`}
              className="flex justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2 text-xs">
              <span>
                {FORMAT_EVENTS[event.kind] ?? 'Format changed'}
                {event.kind === 'created' && event.parentFormatId
                  ? ` · Forked from ${event.parentFormatId === 'orig-3x2' ? 'Original' : event.parentFormatId} at shared edit ${event.forkEditCursor ?? 0}`
                  : ''}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)]">{timeOf(event.at)}</span>
            </li>
          ))}
          {!ordered.length && activeSizeId !== 'orig-3x2' && (
            <li className="text-xs text-[var(--text-muted)]">No format changes recorded yet. Existing projects may predate this timeline.</li>
          )}
        </ol>
        <p className="text-[11px] text-[var(--text-muted)]">Format actions are recorded from this version onwards. Historical previews and restoring format checkpoints are not yet available.</p>
      </section>

      <section className="space-y-2 border-t border-[var(--border-subtle)] pt-4" aria-label="Shared photo edit history">
        <h3 className="text-xs font-semibold text-[var(--text-primary)]">Shared photo edits</h3>
        <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
          Photo-wide edits and masks are shared with linked formats. Select a step to restore the shared recipe.
        </p>
        {!history || !rows.length ? (
          <p className="text-xs text-[var(--text-muted)]">{STRINGS.history.empty}</p>
        ) : (
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
                    <span className="font-medium">{row.label}{current ? ` · ${STRINGS.history.now}` : later ? ` · ${STRINGS.history.undone}` : ''}</span>
                    {row.at !== undefined && <span className="font-mono text-[10px] text-[var(--text-muted)]">{timeOf(row.at)}</span>}
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}

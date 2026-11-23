import React from 'react';
import type { Photo } from '../contract';
import { STRINGS } from '../strings';

interface HistoryPanelProps {
  photo: Photo | null;
  activeSizeId: string;
  onJumpToStep: (photoId: string, cursor: number) => void;
}

const FORMAT_EVENTS: Readonly<Record<string, string>> = STRINGS.history.formatEvents;

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
      <section className="space-y-2" aria-label={STRINGS.history.formatRegion}>
        <h3 className="text-xs font-semibold text-[var(--text-primary)]">
          {STRINGS.history.formatHeading(format?.label ?? STRINGS.history.selectedFormat)}
        </h3>
        <p className="text-[11px] text-[var(--text-secondary)]">
          {activeSizeId === 'orig-3x2'
            ? STRINGS.history.originalFormatHelp
            : STRINGS.history.formatHelp}
        </p>
        <ol className="space-y-1.5" aria-label={STRINGS.history.recordedFormatActions}>
          {activeSizeId === 'orig-3x2' && (
            <li className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2 text-xs">
              {STRINGS.history.importedOriginal}
            </li>
          )}
          {ordered.map((event, i) => (
            <li key={`${event.at}-${event.kind}-${i}`}
              className="flex justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2 text-xs">
              <span>
                {FORMAT_EVENTS[event.kind] ?? STRINGS.history.formatChanged}
                {event.kind === 'created' && event.parentFormatId
                  ? ` · ${STRINGS.history.fromFormat(event.parentFormatId === 'orig-3x2' ? STRINGS.history.originalFormatName : event.parentFormatId, event.forkEditCursor ?? 0)}`
                  : ''}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)]">{timeOf(event.at)}</span>
            </li>
          ))}
          {!ordered.length && activeSizeId !== 'orig-3x2' && (
            <li className="text-xs text-[var(--text-muted)]">{STRINGS.history.formatEmpty}</li>
          )}
        </ol>
        <p className="text-[11px] text-[var(--text-muted)]">{STRINGS.history.formatReadOnly}</p>
      </section>

      <section className="space-y-2 border-t border-[var(--border-subtle)] pt-4" aria-label={STRINGS.history.sharedRegion}>
        <h3 className="text-xs font-semibold text-[var(--text-primary)]">{STRINGS.history.sharedHeading}</h3>
        <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
          {STRINGS.history.sharedHelp}
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

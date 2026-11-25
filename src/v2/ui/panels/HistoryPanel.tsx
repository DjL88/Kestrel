import React from 'react';
import type { Photo } from '../contract';
import { STRINGS } from '../strings';

interface HistoryPanelProps {
  photo: Photo | null;
  activeSizeId: string;
  onForkFromStep: (photoId: string, cursor: number) => void;
  onSwitchVersion: (photoId: string, versionId: string) => void;
  /** One tap: take back the latest step (the same as Undo). */
  onUndo?: () => void;
}

const FORMAT_EVENTS: Readonly<Record<string, string>> = STRINGS.history.formatEvents;

function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Real recorded activity only. Clicking a shared edit checkpoint now creates
 * an independent branch; per-format activity remains read-only. No synthetic
 * historical thumbnails are shown as if they were old rendered snapshots.
 */
export default function HistoryPanel({ photo, activeSizeId, onForkFromStep, onSwitchVersion, onUndo }: HistoryPanelProps) {
  if (!photo) return <p className="text-xs text-[var(--text-muted)]">{STRINGS.history.noPhoto}</p>;
  const format = photo.sizes.find(s => s.id === activeSizeId);
  const events = photo.formatHistory?.filter(e => e.formatId === activeSizeId) ?? [];
  const ordered = [...events].sort((a, b) => a.at - b.at);
  const history = photo.editHistory;
  const versions = photo.editVersions?.versions ?? [{
    id: 'version-original', label: STRINGS.history.editVersionRoot,
    parentId: null, forkCursor: 0, createdAt: 0,
  }];
  const activeVersionId = photo.editVersions?.activeId ?? 'version-original';
  const versionNames = new Map(versions.map((version) => [version.id, version.label]));
  type Row = NonNullable<typeof history>['steps'][number] | { label: string; at: undefined; by?: undefined; changes?: undefined; why?: undefined };
  const rows: Row[] = history ? [{ label: history.originalAvailable === false ? STRINGS.history.earliestSaved : STRINGS.history.original, at: undefined }, ...history.steps] : [];

  return (
    <div className="space-y-5">
      <section className="space-y-2" aria-label={STRINGS.history.editVersionHeading}>
        <label htmlFor="inflight-history-version" className="block text-xs font-semibold text-[var(--text-primary)]">
          {STRINGS.history.editVersionHeading}
        </label>
        <select
          id="inflight-history-version"
          value={activeVersionId}
          onChange={(event) => onSwitchVersion(photo.id, event.target.value)}
          aria-label={STRINGS.history.editVersionSelect}
          className="min-h-11 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-input)] px-3 text-xs text-[var(--text-primary)]"
        >
          {versions.map((version) => (
            <option key={version.id} value={version.id}>
              {version.label}{version.parentId
                ? ` — ${STRINGS.history.editVersionParent(
                    versionNames.get(version.parentId) ?? STRINGS.history.editVersionRoot,
                    version.forkCursor,
                  )}`
                : ''}
            </option>
          ))}
        </select>
        <p className="text-[0.6875rem] text-[var(--text-secondary)]">{STRINGS.history.forkCheckpointHint}</p>
      </section>
      <section className="space-y-2" aria-label={STRINGS.history.formatRegion}>
        <h3 className="text-xs font-semibold text-[var(--text-primary)]">
          {STRINGS.history.formatHeading(format?.label ?? STRINGS.history.selectedFormat)}
        </h3>
        <p className="text-[0.6875rem] text-[var(--text-secondary)]">
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
              <span className="shrink-0 font-mono text-[0.625rem] text-[var(--text-muted)]">{timeOf(event.at)}</span>
            </li>
          ))}
          {!ordered.length && activeSizeId !== 'orig-3x2' && (
            <li className="text-xs text-[var(--text-muted)]">{STRINGS.history.formatEmpty}</li>
          )}
        </ol>
        <p className="text-[0.6875rem] text-[var(--text-muted)]">{STRINGS.history.formatReadOnly}</p>
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
                    onClick={() => onForkFromStep(photo.id, cursor)}
                    className={`flex min-h-10 w-full items-center justify-between gap-3 rounded-[var(--radius-sm)] border px-3 text-left text-xs ${
                      current
                        ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--text-primary)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-input)] hover:border-[var(--border-default)]'
                    } ${later ? 'text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}
                  >
                    <span className="font-medium">{row.label}{current ? ` · ${STRINGS.history.now}` : later ? ` · ${STRINGS.history.undone}` : ''}</span>
                    <span className="shrink-0 text-[0.625rem] font-semibold text-[var(--brand-accent)]">{STRINGS.history.forkFromCheckpoint}</span>
                    {row.at !== undefined && <span className="font-mono text-[0.625rem] text-[var(--text-muted)]">{timeOf(row.at)}</span>}
                  </button>
                  {(row.changes?.length || row.why?.length) && !later ? (
                    <div className="mt-1 space-y-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-3 py-2 text-[0.6875rem] text-[var(--text-secondary)]">
                      {row.changes?.length ? (
                        <>
                          <p className="font-semibold text-[var(--text-primary)]">{STRINGS.history.whatChanged}</p>
                          <ul className="space-y-0.5">
                            {row.changes.map((change) => <li key={change.label}>{STRINGS.history.change(change.label, change.from, change.to)}</li>)}
                          </ul>
                        </>
                      ) : null}
                      {row.why?.length ? (
                        <>
                          <p className="pt-1 font-semibold text-[var(--text-primary)]">{STRINGS.history.why}</p>
                          <ul className="list-disc space-y-0.5 pl-4">
                            {row.why.map((reason, index) => <li key={index}>{reason}</li>)}
                          </ul>
                        </>
                      ) : null}
                      {current && row.by && onUndo ? (
                        <button type="button" onClick={onUndo}
                          className="mt-1 min-h-9 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-xs font-medium text-[var(--text-primary)]">
                          {STRINGS.history.undoThis}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}

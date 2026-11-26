import React, { useState } from 'react';
import type { Photo } from '../contract';
import { STRINGS } from '../strings';

interface HistoryPanelProps {
  photo: Photo | null;
  activeSizeId: string;
  /** Go back (or forward) to a step, like several Undos at once; later steps stay available. */
  onGoToStep: (photoId: string, cursor: number) => void;
  /** Start a new, named version from a step; the current version keeps all its steps. */
  onForkVersion?: (photoId: string, cursor: number, name: string) => void;
  onSwitchVersion: (photoId: string, versionId: string) => void;
  /** One tap: take back the latest step (the same as Undo). */
  onUndo?: () => void;
  onSaveCheckpoint?: (photoId: string, name: string) => void;
  onRestoreCheckpoint?: (photoId: string, checkpointId: string) => void;
  onDeleteCheckpoint?: (photoId: string, checkpointId: string) => void;
  onRestoreFormatCrop?: (photoId: string, formatId: string, eventAt: number) => void;
}

/** Most checkpoints one photo keeps (MAX_CHECKPOINTS in src/core/editBranches.ts). */
const MAX_CHECKPOINTS = 24;
const FIELD = 'min-h-10 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-input)] px-3 text-xs text-[var(--text-primary)]';
const BUTTON = 'min-h-10 shrink-0 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--brand-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)] disabled:opacity-50';

/**
 * Fork the photo's edits from the chosen step into a new version, named here. This is the only place a version gets a
 * name (owner, 26 Nov 2026): ordinary steps stay plain, unnamed rows. The current version keeps every later step.
 */
function ForkVersion({ suggested, onFork }: { suggested: string; onFork: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  return (
    <div className="space-y-2" data-testid="history-fork">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={BUTTON}>
        {STRINGS.history.forkFromCheckpoint}
      </button>
      {open && (
        <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); onFork(name.trim() || suggested); setName(''); setOpen(false); }}>
          <p className="text-[0.6875rem] text-[var(--text-secondary)]">{STRINGS.history.forkCheckpointHint}</p>
          <div className="flex gap-2">
            <label htmlFor="inflight-history-version-name" className="sr-only">{STRINGS.history.versionName}</label>
            <input id="inflight-history-version-name" value={name} maxLength={60} placeholder={suggested} autoFocus
              onChange={(event) => setName(event.target.value)} className={FIELD} />
            <button type="submit" className={BUTTON}>{STRINGS.history.forkFromCheckpoint}</button>
          </div>
        </form>
      )}
    </div>
  );
}

function Checkpoints({ photo, onSave, onRestore, onDelete }: {
  photo: Photo;
  onSave: (name: string) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const checkpoints = photo.editCheckpoints ?? [];
  const [name, setName] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const full = checkpoints.length >= MAX_CHECKPOINTS;
  const fallback = STRINGS.history.checkpointDefault(checkpoints.length + 1);
  return (
    <section className="space-y-2 border-t border-[var(--border-subtle)] pt-4" aria-label={STRINGS.history.checkpointHeading} data-testid="history-checkpoints">
      <p className="text-[0.6875rem] text-[var(--text-secondary)]">{STRINGS.history.checkpointHelp}</p>
      <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (full) return; onSave(name.trim() || fallback); setName(''); }}>
        <label htmlFor="inflight-checkpoint-name" className="sr-only">{STRINGS.history.checkpointName}</label>
        <input id="inflight-checkpoint-name" value={name} maxLength={60} placeholder={fallback} disabled={full}
          onChange={(event) => setName(event.target.value)} className={FIELD} />
        <button type="submit" disabled={full} className={BUTTON}>{STRINGS.history.saveCheckpoint}</button>
      </form>
      {full && <p className="text-[0.6875rem] text-[var(--text-secondary)]" role="status">{STRINGS.history.checkpointFull}</p>}
      {!checkpoints.length ? (
        <p className="text-xs text-[var(--text-muted)]">{STRINGS.history.checkpointEmpty}</p>
      ) : (
        <ol className="space-y-1.5" aria-label={STRINGS.history.checkpointList}>
          {checkpoints.map((checkpoint) => (
            <li key={checkpoint.id} className="space-y-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2 text-xs">
              <div className="flex justify-between gap-3">
                <span className="font-medium text-[var(--text-primary)]">{checkpoint.name}</span>
                <span className="shrink-0 font-mono text-[0.625rem] text-[var(--text-muted)]">{timeOf(checkpoint.createdAt)}</span>
              </div>
              {confirming === checkpoint.id ? (
                <div className="space-y-2" role="group" aria-label={STRINGS.history.deleteCheckpointLabel(checkpoint.name)}>
                  <p className="text-[0.6875rem] text-[var(--text-secondary)]">{STRINGS.history.confirmDeleteQuestion(checkpoint.name)}</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={BUTTON} onClick={() => { setConfirming(null); onDelete(checkpoint.id); }}>{STRINGS.history.confirmDeleteCheckpoint}</button>
                    <button type="button" className={BUTTON} autoFocus onClick={() => setConfirming(null)}>{STRINGS.history.keepCheckpoint}</button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={BUTTON} aria-label={STRINGS.history.openCheckpointLabel(checkpoint.name)} onClick={() => onRestore(checkpoint.id)}>
                    {STRINGS.history.openCheckpoint}
                  </button>
                  <button type="button" className={BUTTON} aria-label={STRINGS.history.deleteCheckpointLabel(checkpoint.name)} onClick={() => setConfirming(checkpoint.id)}>
                    {STRINGS.history.deleteCheckpoint}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** A section that folds away under its heading; the heading is a button that says whether it is open. */
function Fold({ title, initiallyOpen = false, children }: { title: string; initiallyOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <div className="border-t border-[var(--border-subtle)] pt-2">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="flex min-h-10 w-full items-center gap-2 text-left text-xs font-semibold text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)]">
        <span aria-hidden="true" className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
        {title}
      </button>
      {open && <div className="pt-2">{children}</div>}
    </div>
  );
}

const FORMAT_EVENTS: Readonly<Record<string, string>> = STRINGS.history.formatEvents;

function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Real recorded activity only, kept simple (owner, 26 Nov 2026): a plain list of edit steps, where choosing one goes
 * back to it; a new version exists only when the person forks one and names it; checkpoints and each format's own
 * history fold away below. No synthetic historical thumbnails are shown as if they were old rendered snapshots.
 */
export default function HistoryPanel({
  photo, activeSizeId, onGoToStep, onForkVersion, onSwitchVersion, onSaveCheckpoint, onRestoreCheckpoint, onDeleteCheckpoint, onRestoreFormatCrop, onUndo,
}: HistoryPanelProps) {
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
  // The latest crop action is the crop in use now, so only earlier ones offer to be used again.
  const latestCropAt = ordered.filter((event) => event.kind === 'crop').at(-1)?.at;
  type Row = NonNullable<typeof history>['steps'][number] | { label: string; at: undefined; by?: undefined; changes?: undefined; why?: undefined };
  const rows: Row[] = history ? [{ label: history.originalAvailable === false ? STRINGS.history.earliestSaved : STRINGS.history.original, at: undefined }, ...history.steps] : [];
  const checkpointCount = photo.editCheckpoints?.length ?? 0;

  return (
    <div className="space-y-5">
      {versions.length > 1 && (
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
        </section>
      )}

      <section className="space-y-2" aria-label={STRINGS.history.sharedRegion}>
        {!history || !rows.length ? (
          <p className="text-xs text-[var(--text-muted)]">{STRINGS.history.empty}</p>
        ) : (
          <>
            <ol aria-label={STRINGS.history.heading} className="space-y-1">
              {rows.map((row, cursor) => {
                const current = cursor === history.cursor;
                const later = cursor > history.cursor;
                return (
                  <li key={cursor}>
                    <button
                      type="button"
                      aria-current={current ? 'step' : undefined}
                      onClick={() => onGoToStep(photo.id, cursor)}
                      className={`flex min-h-10 w-full items-center justify-between gap-3 rounded-[var(--radius-sm)] border px-3 text-left text-xs ${
                        current
                          ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--text-primary)]'
                          : 'border-transparent hover:border-[var(--border-default)]'
                      } ${later ? 'text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}
                    >
                      <span className={current ? 'font-medium' : undefined}>{row.label}{current ? ` · ${STRINGS.history.now}` : later ? ` · ${STRINGS.history.undone}` : ''}</span>
                      {row.at !== undefined && <span className="shrink-0 font-mono text-[0.625rem] text-[var(--text-muted)]">{timeOf(row.at)}</span>}
                    </button>
                    {current && (row.changes?.length || row.why?.length) ? (
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
                        {row.by && onUndo ? (
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
            {onForkVersion && (
              <ForkVersion key={`${activeVersionId}:${history.cursor}`} suggested={`Version ${versions.length + 1}`}
                onFork={(name) => onForkVersion(photo.id, history.cursor, name)} />
            )}
          </>
        )}
      </section>

      {onSaveCheckpoint && onRestoreCheckpoint && onDeleteCheckpoint && (
        <Fold title={`${STRINGS.history.checkpointHeading}${checkpointCount ? ` (${checkpointCount})` : ''}`} initiallyOpen={checkpointCount > 0}>
          <Checkpoints photo={photo} onSave={(name) => onSaveCheckpoint(photo.id, name)}
            onRestore={(id) => onRestoreCheckpoint(photo.id, id)} onDelete={(id) => onDeleteCheckpoint(photo.id, id)} />
        </Fold>
      )}

      <Fold title={STRINGS.history.formatHeading(format?.label ?? STRINGS.history.selectedFormat)}>
      <section className="space-y-2" aria-label={STRINGS.history.formatRegion}>
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
              <span className="flex shrink-0 items-center gap-2">
                {event.kind === 'crop' && event.crop && event.at !== latestCropAt && onRestoreFormatCrop && (
                  <button type="button" className={BUTTON} aria-label={STRINGS.history.restoreCropLabel(timeOf(event.at))}
                    onClick={() => onRestoreFormatCrop(photo.id, activeSizeId, event.at)}>
                    {STRINGS.history.restoreCrop}
                  </button>
                )}
                <span className="font-mono text-[0.625rem] text-[var(--text-muted)]">{timeOf(event.at)}</span>
              </span>
            </li>
          ))}
          {!ordered.length && activeSizeId !== 'orig-3x2' && (
            <li className="text-xs text-[var(--text-muted)]">{STRINGS.history.formatEmpty}</li>
          )}
        </ol>
        <p className="text-[0.6875rem] text-[var(--text-muted)]">{STRINGS.history.formatReadOnly}</p>
      </section>
      </Fold>
    </div>
  );
}

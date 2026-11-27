import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { isRawPreviewFile } from '../../../core/rawFormats';
import { finishBatchStore } from '../../engineClient/finishBatchStore';
import type { FinishResult } from '../../engineClient/runFinishBatch';
import type { FinishBestControl } from '../../engineClient/useFinishBest';
import { STRINGS } from '../strings';
import { useFocusTrap } from './useFocusTrap';

export interface FinishReviewDialogProps {
  open: boolean;
  control: Pick<FinishBestControl, 'preview' | 'undo' | 'cancel'>;
  /** Show this photo in the editor (a held photo's Auto suggestion is in Co-pilot). The dialog closes. */
  onOpenPhoto: (photoId: string) => void;
  onClose: () => void;
}

type Side = 'before' | 'after';

const small = 'inline-flex min-h-10 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)]';

/** Draws the pictures one or two at a time: fifty full-size renders at once would freeze the page the review is on. */
const MAX_AT_ONCE = 2;
let drawing = 0;
const waiting: Array<() => void> = [];
function drawTurn<T>(job: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = () => {
      // A tile that has gone while it waited drops its turn instead of drawing a picture nobody will see.
      if (signal.aborted) { reject(signal.reason); waiting.shift()?.(); return; }
      drawing += 1;
      job().then(resolve, reject).finally(() => { drawing -= 1; waiting.shift()?.(); });
    };
    if (drawing < MAX_AT_ONCE) start(); else waiting.push(start);
  });
}

/** One picture, drawn when it scrolls into view. The URL is released when the tile goes. */
function ReviewPicture({ photoId, filename, side, caption, version, preview }: { photoId: string; filename: string; side: Side; /** Says in words which picture this is; none for a photo that was not changed. */ caption?: string; version: string; preview: FinishBestControl['preview'] }) {
  const t = STRINGS.finishBest.review;
  const host = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  const [shown, setShown] = useState<{ key: string; url: string | null } | null>(null);
  const key = `${photoId}:${side}:${version}`;
  useEffect(() => {
    const node = host.current;
    if (!node || seen) return;
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
    const watcher = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) { setSeen(true); watcher.disconnect(); } }, { rootMargin: '200px' });
    watcher.observe(node);
    return () => watcher.disconnect();
  }, [seen]);
  useEffect(() => {
    if (!seen) return;
    let live = true;
    let made: string | null = null;
    const gone = new AbortController();
    void drawTurn(() => preview(photoId, side, gone.signal), gone.signal).then((url) => {
      made = url;
      if (live) setShown({ key, url }); else if (url) URL.revokeObjectURL(url);
    }).catch(() => { if (live) setShown({ key, url: null }); });
    return () => { live = false; gone.abort(); if (made) URL.revokeObjectURL(made); };
  }, [seen, key, photoId, side, preview]);
  const current = shown?.key === key ? shown : null;
  return (
    <div ref={host} className="relative flex aspect-[3/2] w-full items-center justify-center overflow-hidden rounded-[var(--radius-sm)] bg-[var(--bg-surface-sunken,var(--bg-canvas))] text-xs text-[var(--text-secondary)]">
      {current?.url ? <img src={current.url} alt={caption ? `${filename}, ${caption}` : filename} className="h-full w-full object-contain" />
        : <span className="px-2 text-center">{current ? (isRawPreviewFile(filename) ? t.noPreviewRaw : t.noPreview) : t.loading}</span>}
      {caption && <span data-testid="finish-picture-caption" aria-hidden="true" className="absolute left-1.5 top-1.5 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-xs font-semibold text-[var(--text-primary)]">{caption}</span>}
    </div>
  );
}

/**
 * The review after a Finish best batch. Every edit here is already applied and is one Undo; the person keeps the ones
 * they like and undoes the rest. Held photos were not changed: they are listed, never hidden. Nothing is removed or
 * rejected here, and a photo edited again since can only be taken back from History, which the tile says.
 */
export default function FinishReviewDialog({ open, control, onOpenPhoto, onClose }: FinishReviewDialogProps) {
  const t = STRINGS.finishBest;
  const r = t.review;
  const batch = useSyncExternalStore(finishBatchStore.subscribe, finishBatchStore.getSnapshot, finishBatchStore.getSnapshot);
  const [side, setSide] = useState<Side>('after');
  const dialogRef = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useFocusTrap(open, dialogRef, onClose, closeButton);
  useEffect(() => { if (open) setSide('after'); }, [open]);
  if (!open) return null;

  const applied = batch.results.filter((result) => result.state === 'applied');
  const held = batch.results.filter((result) => result.state === 'held');
  const left = batch.results.filter((result) => result.state !== 'applied' && result.state !== 'held');
  const waitingForLook = applied.filter((result) => result.review === 'pending').length;
  const running = batch.phase === 'running';

  const tile = (result: FinishResult) => (
    <li key={result.photoId} data-testid="finish-review-tile" data-state={result.state} data-review={result.review} className="flex flex-col gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-default)] p-2">
      <ReviewPicture photoId={result.photoId} filename={result.filename} side={side} caption={side === 'before' ? r.before : r.after} version={result.review === 'undone' ? 'undone' : 'edited'} preview={control.preview} />
      <p className="truncate text-sm font-semibold" title={result.filename}>{result.filename}</p>
      {result.applied && <p className="text-xs text-[var(--text-primary)]">{result.applied}</p>}
      <p className="text-xs text-[var(--text-secondary)]">{result.why}</p>
      {result.changedSince && <p role="status" className="text-xs font-semibold">{r.changedSince}</p>}
      <div className="mt-auto flex flex-wrap items-center gap-2">
        {result.review !== 'pending' && <span className="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2 py-0.5 text-xs font-semibold">{result.review === 'kept' ? r.kept : r.undone}</span>}
        {result.review === 'pending' && (
          <button type="button" className={small} aria-label={r.keepPhoto(result.filename)} onClick={() => finishBatchStore.mark(result.photoId, { review: 'kept' })}>{r.keep}</button>
        )}
        {result.review !== 'undone' && (
          <button type="button" className={small} aria-label={r.undoPhoto(result.filename)} onClick={() => control.undo(result.photoId)}>{r.undo}</button>
        )}
      </div>
    </li>
  );

  return (
    <div className="fixed inset-0 z-[80] flex items-stretch justify-center bg-black/60 p-0 sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="v2-finish-review-title" data-testid="finish-review-dialog"
        className="flex h-[100dvh] w-full max-w-5xl flex-col bg-[var(--bg-surface)] p-4 text-[var(--text-primary)] shadow-[var(--shadow-panel)] sm:h-auto sm:max-h-[92dvh] sm:rounded-[var(--radius-lg)] sm:border sm:border-[var(--border-default)] sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 id="v2-finish-review-title" className="text-base font-semibold">{r.heading(applied.length)}</h2>
          <button ref={closeButton} type="button" onClick={onClose} className={small}>{r.close}</button>
        </div>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">{r.intro}</p>
        {running && (
          <p role="status" aria-live="polite" data-testid="finish-review-progress" className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span>{t.busy} {batch.results.length}/{batch.total}</span>
            <button type="button" className={small} onClick={control.cancel}>{t.cancel}</button>
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div role="group" aria-label={r.showing} className="inline-flex items-center gap-1">
            <span className="mr-1 text-sm">{r.showing}</span>
            {(['before', 'after'] as const).map((value) => (
              <button key={value} type="button" aria-pressed={side === value} data-testid={`finish-show-${value}`} onClick={() => setSide(value)}
                className={`${small} gap-1 ${side === value ? 'bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]' : ''}`}>
                {side === value && <span aria-hidden="true">✓</span>}{value === 'before' ? r.before : r.after}</button>
            ))}
          </div>
          <button type="button" data-testid="finish-approve-all" disabled={waitingForLook === 0} onClick={() => finishBatchStore.keepAll()}
            className="min-h-10 rounded-[var(--radius-sm)] bg-[var(--brand-accent)] px-4 text-sm font-semibold text-[var(--text-on-accent)] hover:bg-[var(--brand-accent-hover)] disabled:opacity-50">{r.approveAll}</button>
        </div>
        <div className="mt-3 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {batch.results.length === 0 && <p className="text-sm">{r.empty}</p>}
          {applied.length > 0 && (
            <section aria-label={r.appliedHeading(applied.length)}>
              <h3 className="mb-2 text-sm font-semibold">{r.appliedHeading(applied.length)}</h3>
              <ul className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{applied.map(tile)}</ul>
            </section>
          )}
          {held.length > 0 && (
            <section aria-label={r.heldHeading(held.length)} data-testid="finish-held">
              <h3 className="text-sm font-semibold">{r.heldHeading(held.length)}</h3>
              <p className="mb-2 text-xs text-[var(--text-secondary)]">{r.heldIntro}</p>
              <ul className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {held.map((result) => (
                  <li key={result.photoId} data-testid="finish-held-tile" className="flex flex-col gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-default)] p-2">
                    <ReviewPicture photoId={result.photoId} filename={result.filename} side="after" version="held" preview={control.preview} />
                    <p className="truncate text-sm font-semibold" title={result.filename}>{result.filename}</p>
                    <p className="text-xs text-[var(--text-secondary)]">{result.heldReason ?? result.why}</p>
                    <button type="button" className={`${small} mt-auto self-start`} aria-label={r.openPhoto(result.filename)} onClick={() => { onOpenPhoto(result.photoId); onClose(); }}>{r.open}</button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {left.length > 0 && (
            <section aria-label={r.leftHeading(left.length)}>
              <h3 className="mb-2 text-sm font-semibold">{r.leftHeading(left.length)}</h3>
              <ul className="divide-y divide-[var(--border-default)]">
                {left.map((result) => (
                  <li key={result.photoId} data-testid="finish-left-row" data-state={result.state} className="py-1.5 text-sm">
                    <span className="font-semibold">{result.filename}</span>
                    <span className="ml-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-1.5 py-0.5 text-xs font-semibold">{r.states[result.state]}</span>
                    <span className="mt-0.5 block text-xs text-[var(--text-secondary)]">{result.why}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}

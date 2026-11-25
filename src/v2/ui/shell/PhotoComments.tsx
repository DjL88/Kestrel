import { useCallback, useEffect, useRef, useState } from 'react';
import { photoToScreen, screenToPhoto, type PhotoPoint } from '../../../core/editingSequence';
import { COMMENT_MAX_CHARS, type CommentThread } from '../../../core/photoComments';
import type { CollabClient } from '../../../providers/collabClient';
import { readSharedLink } from '../dialogs/sharedLinks';
import { STRINGS } from '../strings';
import { frameElement } from './usePresence';

/**
 * Comments on photos in a shared project: threads pinned to a point on the photo (relative, so a pin stays on the same
 * feather at any zoom) or about the whole photo, with replies, resolve and reopen. Only for a project linked to a shared
 * one; anything that fails leaves the editor as it is. Pins carry their number and a shape, never colour alone.
 */
type Thread = CommentThread & { number: number };
type Change = { kind: 'reply'; text: string } | { kind: 'resolve' } | { kind: 'reopen' };

export function usePhotoComments(client: CollabClient, localProjectId: string | null, photoId: string | null, refreshKey: number) {
  const shared = localProjectId && client.configured ? readSharedLink(localProjectId) : null;
  const [threads, setThreads] = useState<Thread[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [canComment, setCanComment] = useState(false);
  const [failed, setFailed] = useState(false);
  const live = useRef(0);

  const reload = useCallback(async () => {
    const ticket = ++live.current;
    if (!shared) { setThreads([]); setCounts({}); setCanComment(false); return; }
    try {
      const [onPhoto, all] = await Promise.all([photoId ? client.comments(shared, photoId) : Promise.resolve({ threads: [], canComment: false }), client.commentCounts(shared)]);
      if (ticket !== live.current) return;
      setThreads(onPhoto.threads); setCanComment(onPhoto.canComment); setCounts(all); setFailed(false);
    } catch {
      if (ticket === live.current) setFailed(true);
    }
  }, [client, shared, photoId]);

  useEffect(() => { void reload(); }, [reload, refreshKey]);
  // Others' comments arrive on a calm minute poll; nothing moves under the pointer while you read.
  useEffect(() => {
    if (!shared) return;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void reload(); }, 60_000);
    return () => clearInterval(timer);
  }, [shared, reload]);

  const run = useCallback(async (work: () => Promise<unknown>) => {
    try { await work(); setFailed(false); await reload(); return true; } catch { setFailed(true); return false; }
  }, [reload]);

  return {
    shared: Boolean(shared), threads, counts, canComment, failed,
    start: (pin: PhotoPoint | null, text: string) => run(() => client.startComment(shared!, photoId!, pin, text)),
    change: (threadId: string, change: Change) => run(() => client.changeComment(shared!, photoId!, threadId, change)),
  };
}

const bubble = <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16"><path d="M2 3h12v8H7l-3 3v-3H2z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>;

/** The top bar button. Shown only for a shared project. */
export function CommentsButton({ open, openCount, onToggle }: { open: boolean; openCount: number; onToggle: () => void }) {
  const t = STRINGS.comments;
  const label = openCount ? t.buttonCount(openCount) : t.button;
  return (
    <button type="button" data-testid="comments-button" onClick={onToggle} aria-pressed={open} aria-label={label} title={label}
      className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">
      {bubble}<span className={open ? 'font-semibold' : ''}>{t.button}</span>{openCount > 0 && <span className="font-semibold">{openCount}</span>}
    </button>
  );
}

function useFrameRect(active: boolean) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!active) { setRect(null); return; }
    let frame = 0;
    const tick = () => { const element = frameElement(); setRect(element ? element.getBoundingClientRect() : null); frame = requestAnimationFrame(tick); };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [active]);
  return rect;
}

/**
 * Numbered pins over the photo while the comments sheet is open, and the click target for placing a new one.
 * A pin is a button: choosing it selects its thread in the sheet.
 */
export function CommentPins({ threads, showResolved, selectedId, placing, draftPin, onSelect, onPlace }: {
  threads: Thread[]; showResolved: boolean; selectedId: string | null; placing: boolean; draftPin: PhotoPoint | null;
  onSelect: (id: string) => void; onPlace: (pin: PhotoPoint) => void;
}) {
  const t = STRINGS.comments;
  const pinned = threads.filter((thread) => thread.pin && (showResolved || !thread.resolved));
  const rect = useFrameRect(pinned.length > 0 || placing || draftPin !== null);
  if (!rect) return null;
  return (
    <div data-testid="comment-pins" className="pointer-events-none fixed inset-0 z-[61]">
      {placing && (
        <button type="button" data-testid="comment-place-target" aria-label={t.placeHint}
          className="pointer-events-auto absolute cursor-crosshair border-2 border-dashed border-[var(--text-primary)] bg-transparent"
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
          onClick={(event) => {
            const point = screenToPhoto(event.clientX, event.clientY, { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
            if (point) onPlace(point);
          }} />
      )}
      {pinned.map((thread) => {
        const at = photoToScreen(thread.pin!, rect);
        const selected = thread.id === selectedId;
        return (
          <button key={thread.id} type="button" data-testid="comment-pin" onClick={() => onSelect(thread.id)}
            aria-label={`${t.pinLabel(thread.number)}${thread.resolved ? `, ${t.resolved}` : ''}`} aria-pressed={selected}
            className={`pointer-events-auto absolute -translate-x-1/2 -translate-y-full inline-flex items-center gap-0.5 rounded-full border bg-[var(--bg-surface)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--text-primary)] shadow ${selected ? 'border-2 border-[var(--text-primary)]' : 'border-[var(--border-default)]'} ${thread.resolved ? 'line-through opacity-70' : ''}`}
            style={{ left: at.x, top: at.y }}>
            {bubble}{thread.number}{thread.resolved && <span aria-hidden="true">✓</span>}
          </button>
        );
      })}
      {draftPin && (() => {
        const at = photoToScreen(draftPin, rect);
        return <span aria-hidden="true" data-testid="comment-draft-pin" className="absolute -translate-x-1/2 -translate-y-full rounded-full border-2 border-dashed border-[var(--text-primary)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-[11px] font-semibold" style={{ left: at.x, top: at.y }}>+</span>;
      })()}
    </div>
  );
}

function Composer({ label, submit, onSubmit, onCancel, autoFocus }: { label: string; submit: string; onSubmit: (text: string) => Promise<boolean>; onCancel?: () => void; autoFocus?: boolean }) {
  const t = STRINGS.comments;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const ok = await onSubmit(text);
    setBusy(false);
    if (ok) setText('');
  };
  return (
    <div className="mt-2 flex flex-col gap-1">
      <textarea aria-label={label} placeholder={label} value={text} maxLength={COMMENT_MAX_CHARS} rows={2} autoFocus={autoFocus}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); } }}
        className="w-full resize-y rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-canvas)] p-2 text-[12px] text-[var(--text-primary)]" />
      <div className="flex justify-end gap-1">
        {onCancel && <button type="button" onClick={onCancel} className="h-7 rounded-[var(--radius-sm)] px-2 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]">{t.cancel}</button>}
        <button type="button" disabled={!text.trim() || busy} onClick={() => void send()}
          className="h-7 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2 text-[11px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-50">{submit}</button>
      </div>
    </div>
  );
}

/** The side sheet: threads on the photo on screen, open first, and adding a new one. */
export function CommentsSheet({ comments, onClose, selectedId, onSelect, placing, onStartPlacing, draftPin, onClearDraft, showResolved, onToggleResolved }: {
  comments: ReturnType<typeof usePhotoComments>; onClose: () => void; selectedId: string | null; onSelect: (id: string | null) => void;
  placing: boolean; onStartPlacing: () => void; draftPin: PhotoPoint | null | 'whole'; onClearDraft: () => void; showResolved: boolean; onToggleResolved: () => void;
}) {
  const t = STRINGS.comments;
  const resolvedCount = comments.threads.filter((thread) => thread.resolved).length;
  const visible = comments.threads.filter((thread) => showResolved || !thread.resolved);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (placing || draftPin) onClearDraft(); else onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [placing, draftPin, onClearDraft, onClose]);
  useEffect(() => { if (selectedId) ref.current?.querySelector(`[data-thread="${selectedId}"]`)?.scrollIntoView({ block: 'nearest' }); }, [selectedId]);
  return (
    <aside ref={ref} role="complementary" aria-label={t.heading} data-testid="comments-sheet"
      className="fixed bottom-4 right-4 top-16 z-[62] flex w-80 max-w-[calc(100vw-2rem)] flex-col rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-lg">
      <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2">
        <h2 className="text-[13px] font-semibold">{t.heading}</h2>
        <button type="button" onClick={onClose} className="h-7 rounded-[var(--radius-sm)] px-2 text-[11px] hover:bg-[var(--bg-surface-hover)]">{t.close}</button>
      </header>
      <div className="flex-1 overflow-y-auto inflight-scroll p-3 text-[12px]">
        {comments.failed && <p role="status" className="mb-2 text-[var(--text-secondary)]">⚠ {t.failed}</p>}
        {!comments.canComment && <p className="mb-2 text-[var(--text-secondary)]">{t.readOnly}</p>}
        {comments.canComment && !draftPin && (
          <button type="button" data-testid="comment-add" onClick={onStartPlacing} aria-pressed={placing}
            className="mb-2 h-8 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] text-[12px] font-semibold hover:bg-[var(--bg-surface-hover)]">
            {placing ? t.placeHint : t.add}
          </button>
        )}
        {draftPin && (
          <div className="mb-3 rounded-[var(--radius-sm)] border border-dashed border-[var(--border-default)] p-2">
            <p className="text-[11px] text-[var(--text-secondary)]">{draftPin === 'whole' ? t.wholePhoto : t.pinned}</p>
            <Composer label={t.write} submit={t.post} autoFocus onCancel={onClearDraft}
              onSubmit={async (text) => { const ok = await comments.start(draftPin === 'whole' ? null : draftPin, text); if (ok) onClearDraft(); return ok; }} />
          </div>
        )}
        {visible.length === 0 && !draftPin && <p className="text-[var(--text-secondary)]">{t.none}</p>}
        <ol className="flex flex-col gap-2">
          {visible.map((thread) => (
            <li key={thread.id} data-thread={thread.id} data-testid="comment-thread"
              className={`rounded-[var(--radius-sm)] border p-2 ${thread.id === selectedId ? 'border-2 border-[var(--text-primary)]' : 'border-[var(--border-subtle)]'}`}>
              <button type="button" onClick={() => onSelect(thread.id === selectedId ? null : thread.id)} className="flex w-full items-center gap-1 text-left text-[11px] font-semibold">
                {bubble}<span>{thread.pin ? t.pinLabel(thread.number) : `${t.pinLabel(thread.number)} · ${t.wholePhoto}`}</span>
                {thread.resolved && <span className="ml-auto font-normal text-[var(--text-secondary)]">✓ {t.resolvedBy(thread.resolved.byName)}</span>}
              </button>
              <ul className="mt-1 flex flex-col gap-1">
                {thread.entries.map((entry) => (
                  <li key={entry.id}>
                    <span className="font-semibold">{entry.authorName}</span>{' '}
                    <time className="text-[10px] text-[var(--text-secondary)]" dateTime={new Date(entry.atMs).toISOString()}>{new Date(entry.atMs).toLocaleString()}</time>
                    <p className="whitespace-pre-wrap break-words">{entry.text}</p>
                  </li>
                ))}
              </ul>
              {comments.canComment && (
                <>
                  <div className="mt-1 flex justify-end">
                    <button type="button" onClick={() => void comments.change(thread.id, { kind: thread.resolved ? 'reopen' : 'resolve' })}
                      className="h-7 rounded-[var(--radius-sm)] px-2 text-[11px] font-semibold hover:bg-[var(--bg-surface-hover)]">
                      {thread.resolved ? t.reopen : `✓ ${t.resolve}`}
                    </button>
                  </div>
                  {thread.id === selectedId && <Composer label={t.reply} submit={t.reply} onSubmit={(text) => comments.change(thread.id, { kind: 'reply', text })} />}
                </>
              )}
            </li>
          ))}
        </ol>
        {resolvedCount > 0 && (
          <button type="button" onClick={onToggleResolved} aria-pressed={showResolved} className="mt-2 h-7 rounded-[var(--radius-sm)] px-2 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]">
            {showResolved ? t.hideResolved : t.showResolved(resolvedCount)}
          </button>
        )}
        <p className="mt-3 text-[10px] text-[var(--text-secondary)]">{t.privacy}</p>
      </div>
    </aside>
  );
}

/** Everything for comments in one place, so App only renders this and the button. */
export function PhotoCommentsLayer({ comments, open, onClose }: { comments: ReturnType<typeof usePhotoComments>; open: boolean; onClose: () => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [draftPin, setDraftPin] = useState<PhotoPoint | 'whole' | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const clearDraft = useCallback(() => {
    // Esc while placing a pin means "about the whole photo"; Esc on a draft drops it.
    if (placing) { setPlacing(false); setDraftPin('whole'); } else setDraftPin(null);
  }, [placing]);
  useEffect(() => { if (!open) { setPlacing(false); setDraftPin(null); setSelectedId(null); } }, [open]);
  if (!open || !comments.shared) return null;
  return (
    <>
      <CommentPins threads={comments.threads} showResolved={showResolved} selectedId={selectedId} placing={placing}
        draftPin={draftPin && draftPin !== 'whole' ? draftPin : null}
        onSelect={setSelectedId} onPlace={(pin) => { setPlacing(false); setDraftPin(pin); }} />
      <CommentsSheet comments={comments} onClose={onClose} selectedId={selectedId} onSelect={setSelectedId}
        placing={placing} onStartPlacing={() => setPlacing((on) => !on)} draftPin={draftPin} onClearDraft={clearDraft}
        showResolved={showResolved} onToggleResolved={() => setShowResolved((on) => !on)} />
    </>
  );
}

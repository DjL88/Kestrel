import { useCallback, useEffect, useState } from 'react';
import { commentToEdit, type CommentEdit, type CommentRecipe } from '../../../core/commentToEdit';
import { photoToScreen, screenToPhoto } from '../../../core/editingSequence';
import { STEP_LABELS } from '../../engineClient/frameToPhoto';
import type { CollabClient, SharedComment } from '../../../providers/collabClient';
import type { EditRecipe } from '../contract';
import { STRINGS } from '../strings';
import { frameElement } from './usePresence';

interface SharedCommentsProps {
  client: CollabClient;
  /** The shared project and the photo's shared key; nothing shows without both. */
  project: string | null;
  photoKey: string | undefined;
  photoId: string | null;
  recipe: EditRecipe | null;
  /** Whether this person may change the photo now (an editor holding or able to take the checkout). */
  canEdit: boolean;
  onApply: (photoId: string, delta: Partial<EditRecipe>, label: string) => void;
}

/**
 * Comments on the photo in a shared project (#1387 C05), optionally pinned to a spot on it. An editor can ask Co-pilot
 * to read a comment: plain requests ("a bit brighter", "the sky is blown") become a small slider change shown step by
 * step, applied only when the editor approves it, and undoable like any edit.
 */
export default function SharedComments({ client, project, photoKey, photoId, recipe, canEdit, onApply }: SharedCommentsProps) {
  const t = STRINGS.share;
  const [comments, setComments] = useState<SharedComment[] | null>(null);
  const [text, setText] = useState('');
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [pinning, setPinning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [proposal, setProposal] = useState<{ commentId: string; edit: CommentEdit } | null>(null);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => {
    if (!project || !photoKey) { setComments(null); return; }
    try { setComments(await client.comments(project, photoKey)); setProblem(null); } catch { setProblem(t.commentsFailed); }
  }, [client, project, photoKey, t]);

  useEffect(() => { setProposal(null); setPoint(null); setPinning(false); void load(); }, [load]);
  useEffect(() => {
    if (!project || !photoKey) return;
    const timer = setInterval(() => { void load(); }, 30_000);
    return () => clearInterval(timer);
  }, [load, project, photoKey]);

  // Pinning: the next press on the photo marks the spot (the press does nothing else).
  useEffect(() => {
    if (!pinning) return;
    const press = (event: PointerEvent) => {
      const frame = frameElement();
      if (!frame) return;
      const rect = frame.getBoundingClientRect();
      const at = screenToPhoto(event.clientX, event.clientY, { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
      if (!at) return;
      event.preventDefault(); event.stopPropagation();
      setPoint({ x: Math.round(at.x * 1000) / 1000, y: Math.round(at.y * 1000) / 1000 }); setPinning(false);
    };
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') setPinning(false); };
    window.addEventListener('pointerdown', press, true);
    window.addEventListener('keydown', cancel);
    return () => { window.removeEventListener('pointerdown', press, true); window.removeEventListener('keydown', cancel); };
  }, [pinning]);

  if (!project || !photoKey || !photoId) return null;

  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try { await client.addComment(project, photoKey, text.trim(), point); setText(''); setPoint(null); await load(); }
    catch { setProblem(t.commentsFailed); } finally { setBusy(false); }
  };
  const resolve = async (comment: SharedComment, resolved: boolean) => {
    setBusy(true);
    try { await client.resolveComment(project, comment.id, resolved); await load(); } catch { setProblem(t.commentsFailed); } finally { setBusy(false); }
  };
  const ask = (comment: SharedComment) => {
    if (!recipe) return;
    setProposal({ commentId: comment.id, edit: commentToEdit(comment.text, recipe as unknown as CommentRecipe) });
  };
  const approve = async (comment: SharedComment) => {
    if (!proposal || !recipe) return;
    onApply(photoId, proposal.edit.delta as Partial<EditRecipe>, t.commentEditLabel(comment.authorName));
    setProposal(null);
    await resolve(comment, true);
  };

  const open = (comments ?? []).filter((comment) => comment.resolvedAtMs === null);
  const done = (comments ?? []).filter((comment) => comment.resolvedAtMs !== null);
  const pins = open.map((comment, index) => ({ comment, number: index + 1 })).filter((entry) => entry.comment.point);
  const button = 'min-h-8 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2 text-xs font-medium disabled:opacity-50';

  return (
    <section className="mb-4 rounded-[var(--radius-sm)] border border-[var(--border-default)] p-2.5 text-xs" data-testid="shared-comments" aria-labelledby="v2-shared-comments">
      <h3 id="v2-shared-comments" className="mb-1.5 font-semibold">{t.commentsHeading}</h3>
      {problem && <p role="alert" className="mb-1.5">{problem}</p>}
      {comments && open.length === 0 && <p className="mb-1.5 text-[var(--text-secondary)]">{t.commentsNone}</p>}
      <ol className="mb-2 space-y-2">
        {open.map((comment, index) => (
          <li key={comment.id} className="rounded-[var(--radius-sm)] bg-[var(--bg-surface-hover)] p-2">
            <p className="font-medium">{comment.point ? `${index + 1}. ` : ''}{comment.authorName} · {new Date(comment.createdAtMs).toLocaleString()}</p>
            <p className="whitespace-pre-wrap">{comment.text}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {canEdit && <button type="button" disabled={busy} onClick={() => ask(comment)} className={button}>{t.commentAskCopilot}</button>}
              <button type="button" disabled={busy} onClick={() => void resolve(comment, true)} className={button}>{t.commentDone}</button>
            </div>
            {proposal?.commentId === comment.id && (
              <div className="mt-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] p-2" data-testid="comment-proposal">
                {Object.keys(proposal.edit.delta).length === 0 ? <p>{t.commentNoChange}</p> : (
                  <>
                    <p className="mb-1">{t.commentProposal}</p>
                    <ul className="mb-1.5 space-y-0.5">
                      {Object.entries(proposal.edit.delta).map(([key, value]) => (
                        <li key={key}>{STEP_LABELS[key] ?? key}: {String((recipe as unknown as Record<string, number> | null)?.[key] ?? 0)} → {String(value)}</li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap gap-1.5">
                      <button type="button" disabled={busy} onClick={() => void approve(comment)} className={button}>{t.commentApprove}</button>
                      <button type="button" onClick={() => setProposal(null)} className={button}>{t.commentDecline}</button>
                    </div>
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
      {done.length > 0 && (
        <details open={showDone} onToggle={(event) => setShowDone((event.target as HTMLDetailsElement).open)} className="mb-2">
          <summary className="cursor-pointer">{t.commentsDone(done.length)}</summary>
          <ul className="mt-1 space-y-1 text-[var(--text-secondary)]">
            {done.map((comment) => (
              <li key={comment.id} className="flex items-start justify-between gap-2">
                <span className="min-w-0 whitespace-pre-wrap">{comment.authorName}: {comment.text}</span>
                <button type="button" disabled={busy} onClick={() => void resolve(comment, false)} className={button}>{t.commentReopen}</button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <form onSubmit={(event) => { event.preventDefault(); void send(); }} className="space-y-1.5">
        <label className="block">{t.commentLabel}
          <textarea value={text} maxLength={2000} rows={2} onChange={(event) => setText(event.target.value)}
            className="mt-0.5 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-input)] p-2 text-xs" />
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" aria-pressed={pinning} onClick={() => setPinning((v) => !v)} className={button}>{pinning ? t.commentPinning : point ? t.commentPinned : t.commentPin}</button>
          {point && <button type="button" onClick={() => setPoint(null)} className={button}>{t.commentUnpin}</button>}
          <button type="submit" disabled={busy || !text.trim()} className={button}>{t.commentSend}</button>
        </div>
      </form>
      <CommentPins pins={pins} pending={point} />
    </section>
  );
}

/** Numbered markers on the photo for pinned comments. Numbers match the list, so a pin is never colour alone. */
function CommentPins({ pins, pending }: { pins: { comment: SharedComment; number: number }[]; pending: { x: number; y: number } | null }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const count = pins.length + (pending ? 1 : 0);
  useEffect(() => {
    if (!count) return;
    let frame = 0;
    const tick = () => { const element = frameElement(); setRect(element ? element.getBoundingClientRect() : null); frame = requestAnimationFrame(tick); };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [count]);
  if (!count || !rect) return null;
  const marker = (key: string, at: { x: number; y: number }, label: string) => {
    const spot = photoToScreen(at, rect);
    return (
      <span key={key} data-testid="comment-pin" className="absolute left-0 top-0 inline-flex h-6 min-w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-[var(--text-primary)] bg-[var(--bg-surface)] px-1 text-[11px] font-semibold text-[var(--text-primary)]"
        style={{ left: spot.x, top: spot.y }}>{label}</span>
    );
  };
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[59]">
      {pins.map(({ comment, number }) => marker(comment.id, comment.point!, String(number)))}
      {pending && marker('pending', pending, '+')}
    </div>
  );
}

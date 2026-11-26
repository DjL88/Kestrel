import { useEffect, useRef, useState } from 'react';
import { STRINGS } from '../strings';
import type { FeedbackTarget } from '../../../core/feedbackTarget';

export interface FeedbackRequest extends FeedbackTarget {
  x: number;
  y: number;
  screen: string;
  language: string;
}

interface ContributorFeedbackProps {
  request: FeedbackRequest | null;
  onClose: () => void;
  onSend: (request: FeedbackRequest, comment: string) => Promise<void>;
}

/**
 * Contributors' right-click "Feedback on this" (owner, 26 Nov 2026): a one-item menu at the pointer, then a small form
 * showing exactly what will be sent with the comment. Escape or Cancel closes it; nothing is sent until Send.
 */
export default function ContributorFeedback({ request, onClose, onSend }: ContributorFeedbackProps) {
  const t = STRINGS.contributorFeedback;
  const [stage, setStage] = useState<'menu' | 'form'>('menu');
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const menuItem = useRef<HTMLButtonElement>(null);
  const textArea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!request) return;
    setStage('menu'); setComment(''); setStatus('idle');
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (stage === 'menu' ? menuItem.current : textArea.current)?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      if (stage === 'form') previous?.focus();
    };
  }, [request, stage, onClose]);

  if (!request) return null;

  if (stage === 'menu') {
    const x = Math.max(8, Math.min(request.x, window.innerWidth - 228));
    const y = Math.max(8, Math.min(request.y, window.innerHeight - 56));
    return (
      <div className="fixed inset-0 z-[94]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
        onContextMenu={(event) => { event.preventDefault(); onClose(); }}>
        <div role="menu" aria-label={t.menu} data-testid="contributor-feedback-menu"
          className="fixed w-56 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface-raised,var(--bg-surface))] p-1 text-sm text-[var(--text-primary)] shadow-[var(--shadow-panel)]"
          style={{ left: x, top: y }}
          onKeyDown={(event) => { if (event.key === 'Tab') { event.preventDefault(); onClose(); } }}>
          <button ref={menuItem} type="button" role="menuitem" onClick={() => setStage('form')}
            className="flex min-h-9 w-full items-center rounded px-2 text-left hover:bg-[var(--bg-surface-active,var(--bg-input))] focus-visible:bg-[var(--bg-surface-active,var(--bg-input))] focus-visible:outline-none">
            {t.feedbackOnThis}
          </button>
        </div>
      </div>
    );
  }

  const send = async () => {
    if (!comment.trim() || status === 'sending') return;
    setStatus('sending');
    try { await onSend(request, comment.trim()); setStatus('sent'); } catch { setStatus('failed'); }
  };
  const detail = (label: string, value: string) => value ? (
    <div className="grid grid-cols-[8rem_1fr] gap-2"><dt className="text-[var(--text-secondary)]">{label}</dt><dd className="[overflow-wrap:anywhere]">{value}</dd></div>
  ) : null;
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 p-4" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby="v2-feedback-title" aria-describedby="v2-feedback-intro" data-testid="contributor-feedback-dialog"
        className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 text-[var(--text-primary)] shadow-[var(--shadow-panel)]">
        <h2 id="v2-feedback-title" className="mb-2 text-base font-semibold">{t.title}</h2>
        <p id="v2-feedback-intro" className="mb-3 text-sm text-[var(--text-secondary)]">{t.intro}</p>
        <dl className="mb-3 space-y-1 text-xs">
          {detail(t.about, request.target)}
          {detail(t.words, request.text)}
          {detail(t.screen, request.screen)}
          {detail(t.language, request.language)}
        </dl>
        <label className="mb-1 block text-sm font-medium" htmlFor="v2-feedback-comment">{t.comment}</label>
        <textarea id="v2-feedback-comment" ref={textArea} value={comment} maxLength={2000} rows={4}
          placeholder={t.commentHint} disabled={status === 'sending' || status === 'sent'}
          onChange={(event) => { setComment(event.target.value); if (status === 'failed') setStatus('idle'); }}
          className="mb-2 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-input)] p-2 text-sm text-[var(--text-primary)]" />
        <p role="status" aria-live="polite" className="mb-3 min-h-5 text-sm text-[var(--text-secondary)]">
          {status === 'sending' ? t.sending : status === 'sent' ? t.sent : status === 'failed' ? t.failed : ''}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose}
            className="min-h-10 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-sm">{status === 'sent' ? t.close : t.cancel}</button>
          {status !== 'sent' && (
            <button type="button" onClick={() => void send()} disabled={!comment.trim() || status === 'sending'}
              className="min-h-10 rounded-[var(--radius-sm)] bg-[var(--brand-accent)] px-3 text-sm font-medium text-[var(--text-on-accent)] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-accent)]">{t.send}</button>
          )}
        </div>
      </section>
    </div>
  );
}

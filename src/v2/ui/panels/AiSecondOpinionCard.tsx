import React from 'react';
import type { AiSecondOpinionView } from '../contract';
import { aiReviewText as t } from '../../../i18n/areas/aiReview';

interface Props {
  photoId: string;
  view: AiSecondOpinionView;
  onAgree?: () => void;
  onAsk?: (photoId: string) => void;
  onCancel?: () => void;
  onApply?: (photoId: string) => void;
  onDismiss?: () => void;
  onOpenSettings?: () => void;
}

const button = 'inline-flex h-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 text-xs font-medium text-[var(--text-primary)] disabled:opacity-50';

/**
 * Second opinion from the person's own AI (their key, or Ollama / LM Studio on this computer). Shown only once it is set
 * up in Settings. Words, not colours, carry every state; the suggestion is applied only when Apply is pressed.
 */
export default function AiSecondOpinionCard({ photoId, view, onAgree, onAsk, onCancel, onApply, onDismiss, onOpenSettings }: Props) {
  if (view.setup === 'none') {
    return onOpenSettings ? (
      <button type="button" className={`${button} w-full`} onClick={onOpenSettings} data-testid="v2-ai-opinion-setup">{t.setUp}</button>
    ) : null;
  }
  const mine = view.photoId === photoId;
  return (
    <section aria-label={t.title} data-testid="v2-ai-opinion" className="space-y-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3.5">
      <h3 className="text-xs font-semibold text-[var(--text-primary)]">{t.title}</h3>
      <p className="text-[0.6875rem] leading-relaxed text-[var(--text-secondary)]">{t.intro}</p>
      {view.setup === 'consent' && (
        <div role="group" aria-label={t.consentTitle} className="space-y-2">
          <p className="text-xs font-semibold text-[var(--text-primary)]">{t.consentTitle}</p>
          <p className="text-xs leading-relaxed text-[var(--text-secondary)]">{view.consentText}</p>
          <button type="button" className={button} onClick={onAgree}>{t.agree}</button>
        </div>
      )}
      {view.setup === 'ready' && (mine && view.phase === 'asking'
        ? (
          <div className="flex items-center gap-2">
            <span role="status" aria-live="polite" className="text-xs text-[var(--text-secondary)]">{t.asking}</span>
            <button type="button" className={button} onClick={onCancel}>{t.cancel}</button>
          </div>
        )
        : <button type="button" className={button} onClick={() => onAsk?.(photoId)} data-testid="v2-ai-opinion-ask">{t.ask}</button>)}
      {mine && view.message && <p role="status" className="text-xs text-[var(--text-secondary)]">{view.message}</p>}
      {mine && view.phase === 'ready' && view.summary && (
        <div className="space-y-1.5 border-t border-[var(--border-subtle)] pt-2" data-testid="v2-ai-opinion-result">
          <p className="text-xs font-semibold text-[var(--text-primary)]">{t.summary}</p>
          <p className="text-xs leading-relaxed text-[var(--text-primary)]">{view.summary}</p>
          {view.points && view.points.length > 0 && (
            <ul className="space-y-1">
              {view.points.map((point, index) => (
                <li key={index} className="text-xs text-[var(--text-primary)]"><strong className="font-semibold">{point.label}:</strong> {point.detail}</li>
              ))}
            </ul>
          )}
          <p className="text-xs font-semibold text-[var(--text-primary)]">{t.suggested}</p>
          {view.changes && view.changes.length > 0
            ? <ul className="font-mono text-[0.6875rem] text-[var(--text-primary)]">{view.changes.map((line) => <li key={line}>{line}</li>)}</ul>
            : <p className="text-xs text-[var(--text-secondary)]">{t.noChanges}</p>}
          <p className="text-[0.6875rem] text-[var(--text-muted)]">{t.draftNote}</p>
          <div className="flex flex-wrap gap-2">
            {view.changes && view.changes.length > 0 && <button type="button" className={button} onClick={() => onApply?.(photoId)} data-testid="v2-ai-opinion-apply">{t.apply}</button>}
            <button type="button" className={button} onClick={onDismiss}>{t.dismiss}</button>
          </div>
        </div>
      )}
    </section>
  );
}

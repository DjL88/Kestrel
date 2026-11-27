import React from 'react';
import BrandIcon from '../icons/BrandIcon';
import { STRINGS } from '../strings';

/**
 * One-click Auto at the top of Adjust (Dave, 27 Nov: "Lightroom is 1 click", and the editor had no Auto button at all).
 * A press is answered at once: the line under the button says it is looking, then what it changed, or in one line why
 * it changed nothing. The edit is one undoable step, and Before/After shows the difference. Said in words, never by
 * colour alone.
 */
export interface AutoEditButtonProps {
  photoId: string;
  /** What Auto last did for this photo (the button or Auto-pilot). */
  status?: { photoId: string; state: 'working' | 'applied' | 'unchanged' | 'unavailable'; text: string };
  onAuto: (photoId: string) => void;
  onUndo?: () => void;
  /** Before/After is showing. */
  comparing?: boolean;
  onToggleCompare?: () => void;
}

export default function AutoEditButton({ photoId, status, onAuto, onUndo, comparing, onToggleCompare }: AutoEditButtonProps) {
  const t = STRINGS.autoEdit;
  const mine = status && status.photoId === photoId ? status : undefined;
  const working = mine?.state === 'working';
  const small = 'inline-flex min-h-8 items-center rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)]';
  return (
    <section aria-label={t.label} data-testid="auto-edit" className="space-y-1.5">
      <button type="button" data-testid="auto-edit-button" disabled={working} aria-busy={working} title={t.hint}
        onClick={() => onAuto(photoId)}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--brand-accent)] px-3 text-sm font-semibold text-[var(--text-on-accent)] transition-colors hover:bg-[var(--brand-accent-hover)] disabled:opacity-70">
        <BrandIcon name="assist" size={16} />
        <span>{working ? t.working : t.label}</span>
      </button>
      {/* Always in the page, so a screen reader hears each change. */}
      <div role="status" aria-live="polite" data-testid="auto-edit-status" data-state={mine?.state ?? 'idle'} className="min-h-4 text-xs leading-snug text-[var(--text-secondary)]">
        {mine && (
          <p>
            <span className="font-semibold text-[var(--text-primary)]">{t.states[mine.state]}</span>
            {mine.state !== 'working' && mine.text ? <> {mine.text}</> : null}
          </p>
        )}
      </div>
      {mine?.state === 'applied' && (onUndo || onToggleCompare) && (
        <div className="flex flex-wrap gap-2">
          {onToggleCompare && <button type="button" data-testid="auto-edit-compare" aria-pressed={Boolean(comparing)} onClick={onToggleCompare} className={small}>{t.beforeAfter}</button>}
          {onUndo && <button type="button" data-testid="auto-edit-undo" onClick={onUndo} className={small}>{t.undo}</button>}
        </div>
      )}
    </section>
  );
}

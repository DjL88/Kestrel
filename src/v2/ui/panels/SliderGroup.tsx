import React from 'react';
import { STRINGS } from '../strings';
import BrandIcon from '../icons/BrandIcon';

/**
 * One group of edit controls in Adjust › Advanced Edits (Dave, 27 Nov: "group the edit sliders more distinctly"): a card
 * with a heading that opens and closes it, a "Changed" marker in words when any of its values is off its default, and a
 * Reset for just this group. Each group is a labelled region, so a screen reader can move between them by landmark.
 */
export default function SliderGroup({ id, title, open, onToggle, changed, onReset, className = '', testId, children }: {
  id: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  changed: boolean;
  /** Absent when the group's own control already has a Reset beside it (curve, mixer, grading). */
  onReset?: () => void;
  className?: string;
  testId?: string;
  children: React.ReactNode;
}) {
  const headingId = `${id}-heading`;
  const bodyId = `${id}-body`;
  return (
    <section aria-labelledby={headingId} data-testid={testId ?? `slider-group-${id}`} data-changed={changed ? 'true' : undefined}
      className={`rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] ${className}`}>
      <div className="flex min-h-10 items-center gap-2 px-3">
        <h3 id={headingId} className="min-w-0 flex-1 text-xs font-semibold text-[var(--text-primary)]">
          <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}
            className="flex min-h-10 w-full items-center gap-1.5 text-left focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)]">
            <BrandIcon name="chevron-right" size={12}
              className={`shrink-0 text-[var(--text-muted)] transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`} />
            <span className="truncate">{title}</span>
            {changed && (
              <span data-testid="slider-group-changed"
                className="shrink-0 rounded-sm border border-[var(--brand-accent-border)] px-1 text-[0.625rem] font-medium leading-4 text-[var(--brand-accent)]">
                {STRINGS.adjust.groupChanged}
              </span>
            )}
          </button>
        </h3>
        {changed && onReset && (
          <button type="button" onClick={onReset} aria-label={STRINGS.adjust.groupReset(title)} title={STRINGS.adjust.groupReset(title)}
            data-testid="slider-group-reset"
            className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 text-[0.6875rem] font-medium text-[var(--text-muted)] hover:text-[var(--brand-accent)]">
            <BrandIcon name="restore" size={12} />
            <span>{STRINGS.adjust.groupResetShort}</span>
          </button>
        )}
      </div>
      <div id={bodyId} hidden={!open} className="space-y-3 border-t border-[var(--border-subtle)] px-3 pb-3 pt-3">
        {children}
      </div>
    </section>
  );
}

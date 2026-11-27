import React from 'react';
import { STRINGS } from '../strings';

/**
 * Colour-vision support, as a plain switch where you edit. It is the same setting as Settings → Assistance, so turning
 * it on here or there changes both. When on, colour is said in words where you edit: the main colours and anything to
 * watch for, the ends of Temperature and Tint, and red and green areas outlined and numbered on the photo.
 */
export default function ColourVisionToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <div data-testid="cvd-toggle-row" className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2 max-md:border-0 max-md:bg-transparent max-md:px-1 max-md:py-0">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-[var(--text-primary)]">{STRINGS.settings.assistance.cvdLabel}</p>
        <p className="text-[0.6875rem] leading-snug text-[var(--text-muted)] max-md:sr-only">{on ? STRINGS.adjust.cvdOnHint : STRINGS.adjust.cvdOffHint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={STRINGS.settings.assistance.cvdLabel}
        data-testid="cvd-toggle"
        onClick={onToggle}
        className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors max-md:min-h-11 max-md:min-w-11 ${on
          ? 'bg-[var(--brand-accent)] text-[var(--text-on-accent)]'
          : 'border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)]'}`}
      >
        {on ? STRINGS.adjust.cvdOn : STRINGS.adjust.cvdOff}
      </button>
    </div>
  );
}

import React from 'react';
import type { Photo } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon from '../icons/BrandIcon';
import ColourWordsList from './ColourWordsList';
import ColourSenseLine from './ColourSenseLine';

interface AssistPanelProps {
  photo: Photo | null;
  /** Colour-vision support (Settings, Assistance): show the colour check in words. */
  cvdGuidance?: boolean;
  onRefreshReview: (photoId: string) => void;
  onApplySuggestion: (photoId: string, suggestionId: string) => void;
}

export default function AssistPanel({
  photo,
  cvdGuidance = false,
  onRefreshReview,
  onApplySuggestion,
}: AssistPanelProps) {
  if (!photo) {
    return <p className="text-xs text-[var(--text-muted)]">{STRINGS.panelWords.selectToAssist}</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
        {STRINGS.assist.subtitle}
      </p>

      {/* Plain-English Subject & Plumage / Tone Opinion */}
      <section className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3.5 space-y-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
          <BrandIcon name="assist" size={15} className="text-[var(--brand-accent)]" />
          <span>{STRINGS.assist.opinionHeading}</span>
        </div>
        <p className="text-xs leading-relaxed text-[var(--text-primary)]">
          {photo.assistCritique.subjectNote}
        </p>
      </section>

      {/* Colour-Blind Confidence Card */}
      <section className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3.5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
            <BrandIcon name="palette" size={14} className="text-[var(--semantic-info)]" />
            <span>{STRINGS.assist.colourConfidenceHeading}</span>
          </span>
          <span className="font-mono text-[0.625rem] text-[var(--text-muted)]">
            {photo.assistCritique.kelvinEstimate}
          </span>
        </div>
        <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
          {photo.assistCritique.colourConfidence}
        </p>
        {cvdGuidance && photo.assistCritique.colourCheck && <ColourWordsList words={photo.assistCritique.colourCheck} />}
        <p className="text-[0.6875rem] leading-relaxed text-[var(--text-muted)]">
          {STRINGS.assist.safeNote}
        </p>
      </section>

      {/* Quick tweaks */}
      <div className="space-y-2">
        {photo.assistCritique.suggestions.map((sug) => (
          <div
            key={sug.id}
            className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-[var(--text-primary)]">{sug.title}</p>
              <p className="truncate font-mono text-[0.625rem] text-[var(--text-muted)]">{sug.colourReadout}</p>
              <ColourSenseLine note={sug.colourSense} cvdGuidance={cvdGuidance} />
              <ColourSenseLine note={sug.colourMatch} cvdGuidance={cvdGuidance} testId="colour-match" />
            </div>
            <button
              type="button"
              disabled={sug.applied}
              onClick={() => onApplySuggestion(photo.id, sug.id)}
              className={`shrink-0 rounded-[var(--radius-xs)] px-2.5 py-1 text-[0.6875rem] font-semibold transition-colors ${
                sug.applied
                  ? 'bg-[var(--semantic-success-soft)] text-[var(--semantic-success)]'
                  : 'bg-[var(--brand-accent-soft)] text-[var(--brand-accent)] hover:bg-[var(--brand-accent)] hover:text-[var(--text-on-accent)]'
              }`}
            >
              {sug.applied ? 'Done' : STRINGS.assist.applyRecommendation}
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => onRefreshReview(photo.id)}
        className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-surface-hover)]"
      >
        <BrandIcon name="refresh" size={14} />
        <span>{STRINGS.assist.refreshReview}</span>
      </button>
    </div>
  );
}

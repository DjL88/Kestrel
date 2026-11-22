import React from 'react';
import type { AssistMode, FeatureKey, Photo } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon, { assistModeIconName } from '../icons/BrandIcon';

interface CoPilotPanelProps {
  photo: Photo | null;
  assistMode: AssistMode;
  features: Record<FeatureKey, boolean>;
  ongoingCritique: boolean;
  onSetAssistMode: (mode: AssistMode) => void;
  onRunDeepVisionReview: (photoId: string) => void;
  onApplySuggestion: (photoId: string, suggestionId: string) => void;
  onApplyAll: (photoId: string) => void;
  onDismissSuggestion: (photoId: string, suggestionId: string) => void;
}

export default function CoPilotPanel({
  photo,
  assistMode,
  features,
  ongoingCritique,
  onSetAssistMode,
  onRunDeepVisionReview,
  onApplySuggestion,
  onApplyAll,
  onDismissSuggestion,
}: CoPilotPanelProps) {
  if (!photo) {
    return <p className="text-xs text-[var(--text-muted)]">Select a photo to run Flight Analysis.</p>;
  }

  const suggestions = photo.assistCritique.suggestions;
  const unappliedCount = suggestions.filter((s) => !s.applied).length;

  return (
    <div className="space-y-4">
      {/* Mode summary */}
      <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BrandIcon
              name={assistModeIconName(assistMode)}
              size={16}
              className="text-[var(--brand-accent)]"
            />
            <span className="text-xs font-semibold text-[var(--text-primary)]">
              {STRINGS.topBar.assistModes[assistMode]}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {(['solo', 'copilot', 'autopilot'] as AssistMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onSetAssistMode(m)}
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                  assistMode === m
                    ? 'bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {STRINGS.topBar.assistModes[m]}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
          {STRINGS.copilot.modeDescriptions[assistMode]}
        </p>
      </div>

      {/* Renamed Deep Vision Review CTA */}
      <div className="space-y-2">
        <button
          type="button"
          disabled={!features.onlineAi && !features.cloudAssist}
          onClick={() => onRunDeepVisionReview(photo.id)}
          className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)] bg-[var(--brand-accent)] px-3.5 py-2.5 text-left text-[var(--text-on-accent)] transition-colors hover:bg-[var(--brand-accent-hover)] disabled:opacity-50"
        >
          <span className="flex items-center gap-2">
            <BrandIcon name="cloud-assist" size={17} />
            <span>
              <span className="block text-xs font-semibold">{STRINGS.copilot.runReviewButton}</span>
              <span className="block text-[10px] opacity-85">{STRINGS.copilot.runReviewSub}</span>
            </span>
          </span>
          <BrandIcon name="arrow" size={14} />
        </button>

        {ongoingCritique && (
          <p className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
            <BrandIcon name="ready" size={13} className="text-[var(--semantic-success)]" />
            <span>{STRINGS.copilot.ongoingBadge}</span>
          </p>
        )}
        <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
          {STRINGS.copilot.noGenAiNote}
        </p>
      </div>

      {/* Recommendations */}
      <div className="space-y-2.5 border-t border-[var(--border-subtle)] pt-3.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-[var(--text-primary)]">
            {STRINGS.copilot.suggestionsHeading}
          </h3>
          {unappliedCount > 0 && (
            <button
              type="button"
              onClick={() => onApplyAll(photo.id)}
              className="text-[11px] font-semibold text-[var(--brand-accent)] hover:underline"
            >
              {STRINGS.copilot.applyAllSuggestions}
            </button>
          )}
        </div>

        {suggestions.length === 0 ? (
          <p className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3 text-xs text-[var(--text-muted)]">
            No pending suggestions. Run Deep Vision Review anytime to re-analyse your latest edits.
          </p>
        ) : (
          <div className="space-y-2">
            {suggestions.map((sug) => (
              <div
                key={sug.id}
                className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3"
              >
                <p className="text-xs font-semibold text-[var(--text-primary)]">{sug.title}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                  {sug.summary}
                </p>
                <p className="mt-1.5 font-mono text-[10px] text-[var(--text-muted)]">
                  {sug.colourReadout}
                </p>
                <div className="mt-2.5 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={sug.applied}
                    onClick={() => onApplySuggestion(photo.id, sug.id)}
                    className={`inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-2.5 text-[11px] font-medium transition-colors ${
                      sug.applied
                        ? 'bg-[var(--semantic-success-soft)] text-[var(--semantic-success)]'
                        : 'bg-[var(--bg-surface-active)] text-[var(--text-primary)] hover:bg-[var(--brand-accent)] hover:text-[var(--text-on-accent)]'
                    }`}
                  >
                    <BrandIcon name="check" size={12} />
                    <span>{sug.applied ? STRINGS.copilot.applied : STRINGS.copilot.applySingle}</span>
                  </button>
                  {!sug.applied && (
                    <button
                      type="button"
                      onClick={() => onDismissSuggestion(photo.id, sug.id)}
                      className="h-7 rounded-[var(--radius-sm)] px-2 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
                    >
                      {STRINGS.copilot.dismiss}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

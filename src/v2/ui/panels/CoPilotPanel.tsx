import React from 'react';
import type { AssistMode, FeatureKey, Photo } from '../contract';
import { STRINGS } from '../strings';
import ProBadge, { useProHidden } from '../shell/ProBadge';
import BrandIcon, { assistModeIconName } from '../icons/BrandIcon';
import ColourWordsList from './ColourWordsList';
import ColourSenseLine from './ColourSenseLine';
import WatchSteps from './WatchSteps';
import type { CloudRecipeOfferView, EditRecipe } from '../contract';
import CloudRecipeCard from './CloudRecipeCard';
import AiSecondOpinionCard from './AiSecondOpinionCard';
import AssistantSuggestionsCard from './AssistantSuggestionsCard';
import type { AiSecondOpinionView, AssistantSuggestionsView } from '../contract';

interface CoPilotPanelProps {
  photo: Photo | null;
  assistMode: AssistMode;
  features: Record<FeatureKey, boolean>;
  ongoingCritique: boolean;
  /** Colour-vision support (Settings, Assistance): show the colour check in words. */
  cvdGuidance?: boolean;
  /** True while this photo's deep vision review is running. */
  reviewing?: boolean;
  onSetAssistMode: (mode: AssistMode) => void;
  /** The mode is chosen in Settings, not here. */
  onOpenSettings: () => void;
  onRunDeepVisionReview: (photoId: string) => void;
  onRequestLocalAuto?: (photoId: string) => void;
  onApplySuggestion: (photoId: string, suggestionId: string) => void;
  onDismissSuggestion: (photoId: string, suggestionId: string) => void;
  /** Watch: shows a suggestion's steps so far on the photo without applying them. Null clears the preview. */
  onStepPreview?: (delta: Partial<EditRecipe> | null) => void;
  /** Personal style, present only while that preview is on: forget what Auto learnt from this person's edits. */
  onResetStyle?: () => void;
  /** Cloud edit settings, present only while that preview feature is on. */
  cloudRecipe?: {
    prepare: (photoId: string) => Promise<CloudRecipeOfferView>;
    send: (photoId: string, choice: 'send' | 'alternative') => Promise<string>;
    setFullFile: (on: boolean) => boolean;
    fullFileOn: () => boolean;
  };
  /** Bring your own AI (real workspace only). Absent: nothing is shown. */
  aiOpinion?: AiSecondOpinionView;
  aiOpinionActions?: Omit<React.ComponentProps<typeof AiSecondOpinionCard>, 'photoId' | 'view'>;
  /** Suggestions an AI assistant left through the MCP tool for this project. */
  assistantSuggestions?: AssistantSuggestionsView;
  onApplyAssistantSuggestions?: (name: string) => void;
  onDismissAssistantSuggestions?: (name: string) => void;
}

export default function CoPilotPanel({
  photo,
  assistMode,
  features,
  ongoingCritique,
  cvdGuidance = false,
  reviewing = false,
  onOpenSettings,
  onRunDeepVisionReview,
  onRequestLocalAuto,
  onApplySuggestion,
  onDismissSuggestion,
  onStepPreview,
  onResetStyle,
  cloudRecipe,
  aiOpinion,
  aiOpinionActions,
  assistantSuggestions,
  onApplyAssistantSuggestions,
  onDismissAssistantSuggestions,
}: CoPilotPanelProps) {
  const hiddenOnline = useProHidden('onlineAi');
  // Which suggestion is being watched step by step. A different photo stops watching.
  const [watchingId, setWatchingId] = React.useState<string | null>(null);
  React.useEffect(() => setWatchingId(null), [photo?.id]);
  const clearPreview = React.useCallback((delta: Partial<EditRecipe> | null) => onStepPreview?.(delta), [onStepPreview]);
  const hiddenCloud = useProHidden('cloudAssist');
  if (!photo) {
    return <p className="text-xs text-[var(--text-muted)]">{STRINGS.panelWords.selectToAnalyse}</p>;
  }

  const reviewAvailable = features.onlineAi || features.cloudAssist;
  // The person asked not to see Pro features and online review is one this account does not have: leave the whole block out.
  const hideReview = !reviewAvailable && hiddenOnline && hiddenCloud;
  const reviewPending = reviewing;
  const suggestions = photo.assistCritique.suggestions;

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
          <button
            type="button"
            onClick={onOpenSettings}
            className="rounded px-1.5 py-0.5 text-[0.6875rem] font-medium text-[var(--text-secondary)] underline-offset-2 hover:text-[var(--text-primary)] hover:underline"
          >
            {STRINGS.copilot.changeInSettings}
          </button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
          {STRINGS.copilot.modeDescriptions[assistMode]}
        </p>
      </div>

      {/* Renamed Deep Vision Review CTA */}
      <div className="space-y-2">
        {onRequestLocalAuto && (
          <button type="button" onClick={() => onRequestLocalAuto(photo.id)}
            className="w-full min-h-10 rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 text-left text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">
            {STRINGS.copilot.localReviewButton}
          </button>
        )}
        {!hideReview && (
        <>
        <button
          type="button"
          disabled={!reviewAvailable || reviewPending}
          aria-busy={reviewPending}
          aria-describedby="copilot-review-status"
          onClick={() => onRunDeepVisionReview(photo.id)}
          className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)] bg-[var(--brand-accent)] px-3.5 py-2.5 text-left text-[var(--text-on-accent)] transition-colors hover:bg-[var(--brand-accent-hover)] disabled:opacity-50"
        >
          <span className="flex items-center gap-2">
            <BrandIcon name="cloud-assist" size={17} />
            <span>
              <span className="flex items-center gap-1.5 text-xs font-semibold">{reviewPending ? 'Review in progress…' : STRINGS.copilot.runReviewButton}<ProBadge feature="onlineAi" /></span>
              <span className="block text-[0.625rem] opacity-85">{STRINGS.copilot.runReviewSub}</span>
            </span>
          </span>
          <BrandIcon name="arrow" size={14} />
        </button>

        <p id="copilot-review-status" role="status" aria-live="polite" className="text-[0.6875rem] text-[var(--text-secondary)]">
          {reviewPending ? 'Review in progress. Existing suggestions remain available; nothing has been applied.' : !reviewAvailable ? 'Online review is unavailable. Your photos and existing local edits remain usable offline.' : 'Review is optional. Suggestions are not applied without your choice.'}
        </p>
        </>
        )}
        {ongoingCritique && (
          <p className="flex items-center gap-1.5 text-[0.6875rem] text-[var(--text-secondary)]">
            <BrandIcon name="ready" size={13} className="text-[var(--semantic-success)]" />
            <span>{STRINGS.copilot.ongoingBadge}</span>
          </p>
        )}
        <p className="text-[0.6875rem] leading-relaxed text-[var(--text-muted)]">
          {STRINGS.copilot.noGenAiNote}
        </p>
      </div>

      {cloudRecipe && (
        <CloudRecipeCard photoId={photo.id} onPrepare={cloudRecipe.prepare} onSend={cloudRecipe.send}
          onSetFullFile={cloudRecipe.setFullFile} fullFileOn={cloudRecipe.fullFileOn} />
      )}

      {assistantSuggestions && <AssistantSuggestionsCard view={assistantSuggestions} onApply={onApplyAssistantSuggestions} onDismiss={onDismissAssistantSuggestions} />}
      {aiOpinion && <AiSecondOpinionCard photoId={photo.id} view={aiOpinion} {...aiOpinionActions} />}

      {/* Assist, merged: the plain-English read of the photo, and the colour check */}
      <section className="space-y-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3.5">
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
          <BrandIcon name="assist" size={15} className="text-[var(--brand-accent)]" />
          <span>{STRINGS.assist.opinionHeading}</span>
        </div>
        <p className="text-xs leading-relaxed text-[var(--text-primary)]">
          {photo.assistCritique.subjectNote || STRINGS.copilot.nothingYet}
        </p>
      </section>

      <section className="space-y-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3.5">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
            <BrandIcon name="palette" size={14} className="text-[var(--semantic-info)]" />
            <span>{STRINGS.assist.colourConfidenceHeading}</span>
          </span>
          <span className="font-mono text-[0.625rem] text-[var(--text-secondary)]">{photo.assistCritique.kelvinEstimate}</span>
        </div>
        <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
          {photo.assistCritique.colourConfidence || STRINGS.copilot.nothingYet}
        </p>
        {cvdGuidance && photo.assistCritique.colourCheck && <ColourWordsList words={photo.assistCritique.colourCheck} />}
        <p className="text-[0.6875rem] leading-relaxed text-[var(--text-secondary)]">{STRINGS.assist.safeNote}</p>
      </section>

      {/* Recommendations */}
      <div className="space-y-2.5 border-t border-[var(--border-subtle)] pt-3.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-[var(--text-primary)]">
            {STRINGS.copilot.suggestionsHeading}
          </h3>
        </div>

        {suggestions.length === 0 ? (
          <p className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3 text-xs text-[var(--text-muted)]">
            {reviewPending ? STRINGS.copilot.waitingForReview : STRINGS.copilot.noLocalSuggestions}
          </p>
        ) : (
          <div className="space-y-2">
            {suggestions.map((sug) => (
              <div
                key={sug.id}
                className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3"
              >
                <div className="space-y-2">
                  {sug.comparison && (
                    <div className="grid grid-cols-2 gap-1">
                      <figure>
                        <img src={sug.comparison.before} alt="" draggable={false} className="aspect-[4/3] w-full rounded object-contain" />
                        <figcaption className="text-[0.625rem] text-[var(--text-secondary)]">{STRINGS.copilot.previewBefore}</figcaption>
                      </figure>
                      <figure>
                        <img src={sug.comparison.after} alt={sug.title} draggable={false} className="aspect-[4/3] w-full rounded object-contain" />
                        <figcaption className="text-[0.625rem] text-[var(--text-secondary)]">{STRINGS.copilot.previewAfter}</figcaption>
                      </figure>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-[var(--text-primary)]">{sug.title}</p>
                    <p className="line-clamp-2 text-[0.6875rem] leading-snug text-[var(--text-secondary)]">{sug.summary}</p>
                  </div>
                </div>
                <p className="mt-1.5 font-mono text-[0.625rem] text-[var(--text-muted)]">
                  {sug.colourReadout}
                </p>
                <ColourSenseLine note={sug.colourSense} cvdGuidance={cvdGuidance} />
                <ColourSenseLine note={sug.colourMatch} cvdGuidance={cvdGuidance} testId="colour-match" />
                <ColourSenseLine note={sug.secondOpinion} cvdGuidance={cvdGuidance} testId="second-opinion" />
                {sug.styleNote && (
                  <p data-testid="style-note" className="mt-1.5 text-[0.6875rem] leading-snug text-[var(--text-secondary)]">
                    {sug.styleNote}{' '}
                    {onResetStyle && (
                      <button type="button" onClick={onResetStyle} className="underline underline-offset-2 text-[var(--text-primary)] hover:text-[var(--brand-accent)]">
                        Forget my style
                      </button>
                    )}
                  </p>
                )}
                {sug.steps && sug.steps.length > 0 && (
                  <details className="mt-1.5 text-[11px] text-[var(--text-secondary)]">
                    <summary className="cursor-pointer select-none text-[var(--text-primary)]">{STRINGS.copilot.stepsHeading}</summary>
                    <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                      {sug.steps.map((step) => (
                        <li key={step.id}>
                          <span>{step.label}</span>{' '}
                          <span className="font-mono text-[10px] text-[var(--text-muted)]">{step.from} → {step.to}</span>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
                {watchingId === sug.id && onStepPreview && (
                  <WatchSteps
                    suggestion={sug}
                    current={(photo.editGroups.find((group) => group.id === photo.activeGroupId) ?? photo.editGroups[0])?.recipe}
                    onPreview={clearPreview}
                    onApply={() => onApplySuggestion(photo.id, sug.id)}
                    onClose={() => setWatchingId(null)}
                  />
                )}
                <div className="mt-2.5 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={sug.applied}
                    onClick={() => onApplySuggestion(photo.id, sug.id)}
                    className={`inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-2.5 text-[0.6875rem] font-medium transition-colors ${
                      sug.applied
                        ? 'bg-[var(--semantic-success-soft)] text-[var(--semantic-success)]'
                        : 'bg-[var(--bg-surface-active)] text-[var(--text-primary)] hover:bg-[var(--brand-accent)] hover:text-[var(--text-on-accent)]'
                    }`}
                  >
                    <BrandIcon name="check" size={12} />
                    <span>{sug.applied ? STRINGS.copilot.applied : STRINGS.copilot.applySingle}</span>
                  </button>
                  {!sug.applied && onStepPreview && watchingId !== sug.id && (
                    <button
                      type="button"
                      data-testid="watch-start"
                      onClick={() => setWatchingId(sug.id)}
                      className="h-7 rounded-[var(--radius-sm)] px-2 text-[0.6875rem] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]"
                    >
                      {STRINGS.watch.start}
                    </button>
                  )}
                  {!sug.applied && (
                    <button
                      type="button"
                      onClick={() => onDismissSuggestion(photo.id, sug.id)}
                      className="h-7 rounded-[var(--radius-sm)] px-2 text-[0.6875rem] text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
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

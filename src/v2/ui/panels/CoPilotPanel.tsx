import React from 'react';
import type { AssistMode, FeatureKey, Photo } from '../contract';
import { STRINGS } from '../strings';
import FlightModePicker from './FlightModePicker';
import { deepReviewAvailable } from '../utils/deepReview';
import { flightFindings } from '../utils/flightFindings';
import CloudEditsProjectCard, { type CloudEditsProjectCardProps } from './CloudEditsProjectCard';
import BrandIcon from '../icons/BrandIcon';
import ColourWordsList from './ColourWordsList';
import ColourVerdictLine, { type ColourVerdictLineProps } from './ColourVerdictLine';
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
  /** One tap back after an applied suggestion moved the subject's colour warmer or cooler (ColourSense). */
  onNudgeWarmth?: (photoId: string, direction: 'cooler' | 'warmer') => void;
  colourVerdict?: Omit<ColourVerdictLineProps, 'photoId' | 'verdict' | 'words'>;
  /** Cloud edits for the whole project. Absent while cloud edit settings are off. */
  cloudEdits?: CloudEditsProjectCardProps;
  /** Takes back the last edit. Shown beside "Applied". */
  onUndo?: () => void;
  onDismissSuggestion: (photoId: string, suggestionId: string) => void;
  /** Watch: shows a suggestion's steps so far on the photo without applying them. Null clears the preview. */
  onStepPreview?: (delta: Partial<EditRecipe> | null) => void;
  /** Personal style, present only while that preview is on: forget what Auto learnt from this person's edits. */
  onResetStyle?: () => void;
  /** Cloud edit settings, present only while that preview feature is on. */
  cloudRecipe?: {
    prepare: (photoId: string) => Promise<CloudRecipeOfferView>;
    send: (photoId: string, choice: 'send' | 'alternative') => Promise<import('../contract').CloudRecipeResultView>;
    setFullFile: (on: boolean) => boolean;
    fullFileOn: () => boolean;
    /** The remembered answer to "Use InFlight's cloud for this?". */
    consent?: () => import('../../../core/cloudConsent').CloudConsentAnswer;
    setConsent?: (answer: 'yes' | 'no' | 'ask') => import('../../../core/cloudConsent').CloudConsentAnswer;
    /** Opens Settings › Account, where the cloud balance is topped up. */
    onTopUp?: () => void;
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
  onSetAssistMode,
  onRunDeepVisionReview,
  onRequestLocalAuto,
  onApplySuggestion,
  onNudgeWarmth,
  colourVerdict,
  onUndo,
  cloudEdits,
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
  // Which suggestion is being watched step by step. A different photo stops watching.
  const [watchingId, setWatchingId] = React.useState<string | null>(null);
  React.useEffect(() => setWatchingId(null), [photo?.id]);
  const clearPreview = React.useCallback((delta: Partial<EditRecipe> | null) => onStepPreview?.(delta), [onStepPreview]);
  if (!photo) {
    return <p className="text-xs text-[var(--text-muted)]">{STRINGS.panelWords.selectToAnalyse}</p>;
  }

  // On this device, so on every plan and offline too (utils/deepReview.ts). It used to be gated on the online Pro switches.
  const reviewAvailable = deepReviewAvailable({ features, online: typeof navigator === 'undefined' || navigator.onLine !== false });
  const reviewPending = reviewing;
  const suggestions = photo.assistCritique.suggestions;
  const findings = flightFindings([photo.assistCritique.subjectNote, photo.assistCritique.colourConfidence]);

  return (
    <div className="space-y-4">
      {/* Mode summary */}
      <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3">
        {/* This project's own mode; Settings only sets the default for new projects. */}
        <FlightModePicker compact name="project-flight-mode" label={STRINGS.copilot.modeForProject}
          value={assistMode} onChange={onSetAssistMode} />
      </div>

      {cvdGuidance && <ColourVerdictLine photoId={photo.id} verdict={photo.assistCritique.colourVerdict} {...colourVerdict} />}

      {/* Recommendations first: action and advice (Dave, 27 Nov: "This is very useful to show"). */}
      <div className="space-y-2.5" data-testid="copilot-recommendations">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-[var(--text-primary)]">
            {STRINGS.copilot.suggestionsHeading}
          </h3>
          <details className="relative" data-testid="copilot-about">
            <summary aria-label={STRINGS.copilot.aboutLabel} title={STRINGS.copilot.aboutLabel}
              className="inline-flex h-6 w-6 cursor-pointer list-none items-center justify-center rounded-full border border-[var(--border-default)] text-[0.6875rem] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]">i</summary>
            <div className="absolute right-0 top-full z-20 mt-1 w-64 space-y-1.5 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] p-2.5 text-[0.6875rem] leading-snug text-[var(--text-secondary)] shadow-[var(--shadow-popover)]">
              <p data-testid="flight-mode-about">{STRINGS.copilot.modeDescriptions[assistMode]}</p>
              <p>{STRINGS.copilot.noGenAiNote}</p>
              {ongoingCritique && <p>{STRINGS.copilot.ongoingBadge}</p>}
              <p>{STRINGS.assist.safeNote}</p>
            </div>
          </details>
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
                <ColourSenseLine note={sug.colourSense} cvdGuidance={cvdGuidance}
                  onFix={sug.applied && onNudgeWarmth ? (direction) => onNudgeWarmth(photo.id, direction) : undefined} />
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
                  {sug.applied && onUndo && (
                    <button type="button" data-testid="flight-applied-undo" onClick={onUndo}
                      className="h-7 rounded-[var(--radius-sm)] px-2 text-[0.6875rem] text-[var(--text-secondary)] underline hover:text-[var(--text-primary)]">
                      {STRINGS.colourVerdict.undo}
                    </button>
                  )}
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

      {/* The points only (Dave, 27 Nov: "too wordy and too manual"): what InFlight found, one short line each. */}
      {findings.length > 0 && (
        <section aria-labelledby="flight-findings-heading" data-testid="flight-findings" className="space-y-1.5">
          <h3 id="flight-findings-heading" className="text-xs font-semibold text-[var(--text-primary)]">{STRINGS.copilot.findingsHeading}</h3>
          <ul className="list-disc space-y-1 pl-4 text-xs leading-snug text-[var(--text-primary)]">
            {findings.map((finding) => <li key={finding}>{finding}</li>)}
          </ul>
        </section>
      )}

      {/* The one question that needs the person before Cloud edits can run for this project. */}
      {cloudEdits && <CloudEditsProjectCard {...cloudEdits} askOnly />}

      {/* Everything that needs a press or a read: the on-device checks, cloud edit settings, a helper's opinion and the
          full notes. Closed by default. */}
      <details data-testid="flight-more-checks" className="rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
        <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-[var(--text-primary)]">{STRINGS.copilot.moreChecks}</summary>
        <div className="space-y-4 border-t border-[var(--border-subtle)] p-3">
          {/* Renamed Deep Vision Review CTA */}
          <div className="space-y-2">
            {onRequestLocalAuto && (
              <button type="button" onClick={() => onRequestLocalAuto(photo.id)}
                className="w-full min-h-10 rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 text-left text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">
                {STRINGS.copilot.localReviewButton}
              </button>
            )}
            <button
              type="button"
              disabled={!reviewAvailable || reviewPending}
              aria-busy={reviewPending}
              aria-describedby="copilot-review-status"
              onClick={() => onRunDeepVisionReview(photo.id)}
              className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)] bg-[var(--brand-accent)] px-3.5 py-2.5 text-left text-[var(--text-on-accent)] transition-colors hover:bg-[var(--brand-accent-hover)] disabled:opacity-50"
            >
              <span className="flex items-center gap-2">
                <BrandIcon name="assist" size={17} />
                <span>
                  <span className="flex items-center gap-1.5 text-xs font-semibold">{reviewPending ? STRINGS.copilot.reviewRunningShort : STRINGS.copilot.runReviewButton}</span>
                  <span className="block text-[0.625rem] opacity-85">{STRINGS.copilot.runReviewSub}</span>
                </span>
              </span>
              <BrandIcon name="arrow" size={14} />
            </button>

            <p id="copilot-review-status" role="status" aria-live="polite" className="text-[0.6875rem] text-[var(--text-secondary)]">
              {reviewPending ? STRINGS.copilot.reviewRunning : ''}
            </p>
          </div>

          {cloudEdits && <CloudEditsProjectCard {...cloudEdits} />}
          {cloudRecipe && (
            <CloudRecipeCard photoId={photo.id} onPrepare={cloudRecipe.prepare} onSend={cloudRecipe.send}
              onSetFullFile={cloudRecipe.setFullFile} fullFileOn={cloudRecipe.fullFileOn}
              consent={cloudRecipe.consent} onSetConsent={cloudRecipe.setConsent} onTopUp={cloudRecipe.onTopUp}
              onPreview={onStepPreview ? clearPreview : undefined} />
          )}

          {assistantSuggestions && <AssistantSuggestionsCard view={assistantSuggestions} onApply={onApplyAssistantSuggestions} onDismiss={onDismissAssistantSuggestions} />}
          {aiOpinion && aiOpinion.setup !== 'none' && <AiSecondOpinionCard photoId={photo.id} view={aiOpinion} {...aiOpinionActions} />}

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
          </section>
        </div>
      </details>

    </div>
  );
}

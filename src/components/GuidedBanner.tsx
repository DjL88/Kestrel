import { X } from './icons/KestrelUIIcons';
import type { GuidedStep } from '../core/guidedProgress';
import { libraryText as t } from '../i18n/areas/library';

interface Props {
  step: GuidedStep;
  unreviewed: number;
  keepers: number;
  /** Every photo still waiting was looked at by an automatic cull scan (see `remainingWereScanned`). Only then may the banner say Kite44 wasn't confident. */
  scanned: boolean;
  uneditedKeepers: number;
  onFindBestPhotos: () => void;
  onReviewMyself: () => void;
  onSeeSuggestedEdits: () => void;
  onEditMyself: () => void;
  onExportKeepers: () => void;
  onDismiss: () => void;
}

const primary = 'min-h-11 rounded-md bg-kestrel-copper px-3 text-sm font-semibold text-zinc-950 hover:bg-kestrel-copper-hover! focus-visible:outline-2 focus-visible:outline-sky-300';
const secondary = 'min-h-11 rounded-md border border-white/15 px-3 text-sm text-zinc-100 hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sky-300';

/**
 * One calm, plain-language "what's next" card for someone who doesn't want to go hunting through Workspace options.
 * Shows at most one step at a time, always with one clear primary action and one honest "I'll do it myself" way out —
 * nothing here is forced, and `onDismiss` always works. Hidden entirely for 'empty' and 'none' (see guidedProgress.ts):
 * there's nothing constructive to suggest in either case, so staying quiet is more honest than inventing a prompt.
 */
export function GuidedBanner({ step, unreviewed, keepers, scanned, uneditedKeepers, onFindBestPhotos, onReviewMyself, onSeeSuggestedEdits, onEditMyself, onExportKeepers, onDismiss }: Props) {
  if (step === 'empty' || step === 'none') return null;

  const content = (() => {
    switch (step) {
      case 'reviewing':
        // A cull pass already ran and decided the rest: these are the ones it wasn't confident enough to call,
        // left for a person on purpose. Saying so plainly avoids sounding like it's suggesting the same pass again.
        return scanned ? {
          heading: t.guided.stillNeedDecision(unreviewed),
          body: t.guided.scannedBody,
          primaryLabel: t.guided.tryThese,
          onPrimary: onFindBestPhotos,
          secondaryLabel: t.guided.lookMyself,
          onSecondary: onReviewMyself,
        } : {
          heading: t.guided.toLookThrough(unreviewed),
          body: t.guided.firstPassBody,
          primaryLabel: t.guided.findBest,
          onPrimary: onFindBestPhotos,
          secondaryLabel: t.guided.lookMyself,
          onSecondary: onReviewMyself,
        };
      case 'improving':
        return {
          heading: t.guided.keepersReady(keepers),
          body: uneditedKeepers === keepers
            ? t.guided.suggestEach
            : t.guided.stillNoEdit(uneditedKeepers),
          primaryLabel: t.guided.seeRecipes,
          onPrimary: onSeeSuggestedEdits,
          secondaryLabel: t.guided.editMyself,
          onSecondary: onEditMyself,
        };
      case 'ready':
        return {
          heading: t.guided.allReady(keepers),
          body: t.guided.readyBody,
          primaryLabel: t.guided.exportKeepers,
          onPrimary: onExportKeepers,
          secondaryLabel: undefined,
          onSecondary: undefined,
        };
    }
  })();

  return (
    <section aria-label={t.guided.whatsNext} className="mb-3 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-sky-300/25 bg-sky-300/8 p-3">
      <div className="min-w-0 flex-1 basis-64">
        <h2 className="text-sm font-semibold text-zinc-100">{content.heading}</h2>
        <p className="mt-0.5 text-sm text-zinc-300">{content.body}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {content.secondaryLabel && content.onSecondary && (
          <button type="button" className={secondary} onClick={content.onSecondary}>{content.secondaryLabel}</button>
        )}
        <button type="button" className={primary} onClick={content.onPrimary}>{content.primaryLabel}</button>
        <button type="button" aria-label={t.guided.dismissSuggestion} title={t.guided.dismiss} onClick={onDismiss}
          className="grid min-h-11 min-w-11 place-items-center rounded-md text-zinc-400 hover:bg-white/8 hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-sky-300">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

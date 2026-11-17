import { X } from 'lucide-react';
import type { GuidedStep } from '../core/guidedProgress';
import { formatCount } from '../i18n/messages';

interface Props {
  step: GuidedStep;
  unreviewed: number;
  keepers: number;
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
export function GuidedBanner({ step, unreviewed, keepers, uneditedKeepers, onFindBestPhotos, onReviewMyself, onSeeSuggestedEdits, onEditMyself, onExportKeepers, onDismiss }: Props) {
  if (step === 'empty' || step === 'none') return null;

  const content = (() => {
    switch (step) {
      case 'reviewing':
        return {
          heading: unreviewed === 1 ? '1 photo to look through' : `${formatCount.format(unreviewed)} photos to look through`,
          body: 'Kestrel can take a first pass and suggest your best shots, or you can look through them yourself. Either way, nothing is deleted and every decision can be changed.',
          primaryLabel: 'Find my best photos',
          onPrimary: onFindBestPhotos,
          secondaryLabel: "I'll look through them myself",
          onSecondary: onReviewMyself,
        };
      case 'improving':
        return {
          heading: keepers === 1 ? '1 keeper ready for a look' : `${formatCount.format(keepers)} keepers ready for a look`,
          body: uneditedKeepers === keepers
            ? 'Kestrel can suggest colour and tone for each one. You keep, change or reset every suggestion individually.'
            : `${formatCount.format(uneditedKeepers)} of those still have no edit. Kestrel can suggest colour and tone for them.`,
          primaryLabel: 'See suggested edits',
          onPrimary: onSeeSuggestedEdits,
          secondaryLabel: "I'll edit them myself",
          onSecondary: onEditMyself,
        };
      case 'ready':
        return {
          heading: keepers === 1 ? 'Your keeper is ready' : `Your ${formatCount.format(keepers)} keepers are ready`,
          body: 'Every keeper has been looked through and edited. Export when you\'re happy with them.',
          primaryLabel: 'Export your keepers',
          onPrimary: onExportKeepers,
          secondaryLabel: undefined,
          onSecondary: undefined,
        };
    }
  })();

  return (
    <section aria-label="What's next" className="mb-3 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-sky-300/25 bg-sky-300/8 p-3">
      <div className="min-w-0 flex-1 basis-64">
        <h2 className="text-sm font-semibold text-zinc-100">{content.heading}</h2>
        <p className="mt-0.5 text-sm text-zinc-300">{content.body}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {content.secondaryLabel && content.onSecondary && (
          <button type="button" className={secondary} onClick={content.onSecondary}>{content.secondaryLabel}</button>
        )}
        <button type="button" className={primary} onClick={content.onPrimary}>{content.primaryLabel}</button>
        <button type="button" aria-label="Dismiss this suggestion" title="Dismiss" onClick={onDismiss}
          className="grid min-h-11 min-w-11 place-items-center rounded-md text-zinc-400 hover:bg-white/8 hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-sky-300">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

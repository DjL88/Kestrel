import { Check, RotateCcw, Trash2, X } from 'lucide-react';
import type { CullDecision } from '../core/types';
import { libraryText as t } from '../i18n/areas/library';

interface Props {
  decision: CullDecision;
  filename: string;
  edited: boolean;
  /** Show words beside the icons, for roomy places such as the loupe bar. */
  labels?: boolean;
  /** Spread the buttons across the full width, for narrow cards. */
  stretch?: boolean;
  onKeep: () => void;
  onBackToReview: () => void;
  onTrash: () => void;
  onReset: () => void;
}

/**
 * The buttons depend on where the photo is, so none of them only undoes the last one:
 * To review: Keep or Trash. Keepers: cross returns it to review, and Trash moves it on.
 * Trash: cross returns it to review, and Trash removes it from the library. Reset is always beside them.
 */
export function DecisionButtons({ decision, filename, edited, labels = false, stretch = false, onKeep, onBackToReview, onTrash, onReset }: Props) {
  const base = labels
    ? 'inline-flex h-11 min-w-11 items-center justify-center gap-1 rounded-md px-1.5 sm:gap-1.5 sm:px-2.5 text-sm text-zinc-200 hover:bg-white/8'
    : 'decision-button inline-flex min-h-7 min-w-7 items-center justify-center rounded border border-white/10 bg-white/4 px-1.5 text-zinc-300 hover:text-zinc-100';
  const stop = (action: () => void) => (event: { stopPropagation: () => void }) => { event.stopPropagation(); action(); };
  const trashLabel = decision === 'reject' ? t.decision.removePhoto(filename) : t.decision.trashPhoto(filename);
  return (
    <div className={stretch ? 'grid w-full grid-cols-3 gap-1' : 'flex shrink-0 items-center gap-1'}>
      {decision === 'unreviewed' ? (
        <button type="button" onClick={stop(onKeep)} aria-label={t.decision.keepPhoto(filename)} title={t.decision.keep} className={`${base} hover:bg-sky-500/15`}>
          <Check className="h-3.5 w-3.5" aria-hidden="true" />{labels && <span className="hidden min-[360px]:inline">{t.decision.keep}</span>}
        </button>
      ) : (
        <button type="button" onClick={stop(onBackToReview)} aria-label={t.decision.backToReviewPhoto(filename)} title={t.decision.backToReview} className={base}>
          <X className="h-3.5 w-3.5" aria-hidden="true" />{labels && <><span className="hidden min-[360px]:inline sm:hidden">{t.decision.review}</span><span className="hidden sm:inline">{t.decision.backToReview}</span></>}
        </button>
      )}
      <button type="button" onClick={stop(onTrash)} aria-label={trashLabel} title={decision === 'reject' ? t.decision.removeFromLibrary : t.decision.moveToTrash}
        className={`${base} hover:bg-orange-500/15`}>
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />{labels && <span className="hidden min-[360px]:inline">{decision === 'reject' ? t.decision.remove : t.decision.trash}</span>}
      </button>
      {(!labels || edited) && <button type="button" onClick={stop(onReset)} disabled={!edited} aria-label={t.decision.resetPhoto(filename)} title={t.decision.resetToOriginal}
        className={`${base} disabled:opacity-35 ${labels ? 'max-[359px]:hidden' : ''}`}>
        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />{labels && <span className="hidden min-[360px]:inline">{t.decision.resetEdit}</span>}
      </button>}
    </div>
  );
}

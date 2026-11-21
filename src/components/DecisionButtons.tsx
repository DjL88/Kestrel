import { Check, CircleHelp, RotateCcw, X } from './icons/KestrelUIIcons';
import type { CullDecision } from '../core/types';
import { libraryText as t } from '../i18n/areas/library';

interface Props {
  decision: CullDecision;
  filename: string;
  edited: boolean;
  /** Show words beside icons on the single-photo toolbar. */
  labels?: boolean;
  /** Narrow cards display three equal touch-size text buttons. */
  stretch?: boolean;
  onKeep: () => void;
  onBackToReview: () => void;
  /** Legacy prop name: this sets Reject, never removes a photo from the catalogue. */
  onTrash: () => void;
  onReset: () => void;
}

/** Decision buttons only change culling state; removal from the library is separate. */
export function DecisionButtons({ decision, filename, edited, labels = false, stretch = false, onKeep, onBackToReview, onTrash, onReset }: Props) {
  const base = labels
    ? 'inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-md px-1.5 sm:gap-1.5 sm:px-2.5 text-sm text-zinc-200 hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sky-300'
    : 'decision-button inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded border border-white/10 bg-white/4 px-1 text-zinc-300 hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-sky-300';
  const sized = stretch ? 'w-full min-w-0' : '';
  const stop = (action: () => void) => (event: { stopPropagation: () => void }) => { event.stopPropagation(); action(); };
  const word = (value: string) => stretch
    ? <span className="min-w-0 truncate text-[10px] font-semibold leading-4">{value}</span>
    : labels ? <span className="hidden min-[360px]:inline">{value}</span> : null;
  const iconClass = stretch ? 'hidden' : 'h-4 w-4 shrink-0';
  return (
    <div className={stretch ? 'grid w-full grid-cols-3 gap-1' : 'flex shrink-0 items-center gap-1'}>
      {decision === 'unreviewed' ? (
        <button type="button" onClick={stop(onKeep)} aria-label={t.decision.keepPhoto(filename)} title={t.decision.keep}
          className={`${base} ${sized} hover:bg-sky-500/15`}>
          <Check className={iconClass} aria-hidden="true" />{word(t.decision.keep)}
        </button>
      ) : (
        <button type="button" onClick={stop(onBackToReview)} aria-label={t.decision.undecidedPhoto(filename)} title={t.decision.undecided}
          className={`${base} ${sized}`}>
          <CircleHelp className={iconClass} aria-hidden="true" />{word(t.decision.undecided)}
        </button>
      )}
      <button type="button" onClick={stop(onTrash)} disabled={decision === 'reject'}
        aria-label={decision === 'reject' ? t.decision.rejectedPhoto(filename) : t.decision.rejectPhoto(filename)}
        aria-pressed={decision === 'reject'} title={decision === 'reject' ? t.decision.rejected : t.decision.reject}
        className={`${base} ${sized} hover:bg-orange-500/15 disabled:cursor-default disabled:opacity-45`}>
        <X className={iconClass} aria-hidden="true" />{word(decision === 'reject' ? t.decision.rejected : t.decision.reject)}
      </button>
      {(!labels || edited) && (
        <button type="button" onClick={stop(onReset)} disabled={!edited}
          aria-label={t.decision.resetPhoto(filename)} title={t.decision.resetToOriginal}
          className={`${base} ${sized} disabled:cursor-default disabled:opacity-35 ${labels ? 'max-[359px]:hidden' : ''}`}>
          <RotateCcw className={iconClass} aria-hidden="true" />{word(t.decision.resetEdit)}
        </button>
      )}
    </div>
  );
}

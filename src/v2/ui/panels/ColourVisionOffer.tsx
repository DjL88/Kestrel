import React from 'react';
import { STRINGS } from '../strings';

/**
 * A calm, one-line, one-time offer to name colours in words (Colour-vision support). It is a question, not a mode to
 * discover in Settings. Yes turns the support on; No thanks is remembered and never asked again. Both are real buttons
 * with words, so nothing depends on colour, and the pair is a labelled group reached by Tab.
 */
export default function ColourVisionOffer({ onAnswer }: { onAnswer: (yes: boolean) => void }) {
  const button = 'rounded-full border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-1 text-xs font-semibold text-[var(--text-secondary)] max-md:min-h-11 max-md:min-w-11';
  return (
    <div role="group" aria-label={STRINGS.adjust.cvdOfferQuestion} data-testid="cvd-offer" className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2 max-md:border-0 max-md:bg-transparent max-md:px-1 max-md:py-0">
      <p className="text-xs font-semibold text-[var(--text-primary)]">{STRINGS.adjust.cvdOfferQuestion}</p>
      <div className="flex gap-2">
        <button type="button" data-testid="cvd-offer-yes" aria-label={STRINGS.adjust.cvdOfferYesLabel} onClick={() => onAnswer(true)} className={button}>{STRINGS.adjust.cvdOfferYes}</button>
        <button type="button" data-testid="cvd-offer-no" aria-label={STRINGS.adjust.cvdOfferNoLabel} onClick={() => onAnswer(false)} className={button}>{STRINGS.adjust.cvdOfferNo}</button>
      </div>
    </div>
  );
}

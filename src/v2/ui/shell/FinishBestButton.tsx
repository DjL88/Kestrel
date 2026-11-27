import React, { useSyncExternalStore } from 'react';
import { finishBatchStore } from '../../engineClient/finishBatchStore';
import { STRINGS } from '../strings';

export interface FinishBestEntry {
  onOpen: () => void;
  onReview: () => void;
}

/**
 * "Finish best…" and, once a batch has run, "Review N finished". Shown only while the finishBest preview is on. The
 * button is busy (in words, not by colour) while a batch runs; Pause and Cancel are on its Tasks row.
 */
export default function FinishBestButton({ entry, compact = false }: { entry: FinishBestEntry; compact?: boolean }) {
  const t = STRINGS.finishBest;
  const batch = useSyncExternalStore(finishBatchStore.subscribe, finishBatchStore.getSnapshot, finishBatchStore.getSnapshot);
  const running = batch.phase === 'running';
  const reviewable = batch.results.length;
  const size = compact ? 'h-8 px-2.5 text-xs' : 'h-7 px-2 text-[0.6875rem]';
  const look = 'inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)]';
  return (
    <>
      <button type="button" data-testid="finish-best-button" title={t.buttonHint} aria-busy={running} disabled={running} onClick={entry.onOpen}
        className={`${look} ${size} bg-[var(--brand-accent-soft)] text-[var(--brand-accent)] disabled:opacity-70`}>
        <span>{running ? t.busy : t.button}</span>
      </button>
      {reviewable > 0 && (
        <button type="button" data-testid="finish-review-button" onClick={entry.onReview} className={`${look} ${size}`}>
          <span>{t.reviewButton(reviewable)}</span>
        </button>
      )}
    </>
  );
}

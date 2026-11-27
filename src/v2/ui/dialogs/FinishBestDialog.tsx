import React, { useMemo, useRef, useState } from 'react';
import { isRawPreviewFile } from '../../../core/rawFormats';
import { defaultFinishRequest, FINISH_DEFAULT_COUNT, FINISH_DEFAULT_PERCENT, FINISH_MAX_COUNT, type FinishCandidate, type FinishPlan, type FinishRequest, type FinishSummary } from '../../../core/finishPlan';
import { STRINGS } from '../strings';
import { useFocusTrap } from './useFocusTrap';

export interface FinishBestDialogProps {
  open: boolean;
  /** What a request would finish, from the catalogue as it is now. */
  plan: (request: FinishRequest) => FinishPlan<FinishCandidate & { filename: string }>;
  /** Re-read the plan when the photos change (a number that changes with the catalogue). */
  version: unknown;
  onStart: (request: FinishRequest) => void;
  onClose: () => void;
}

type Mode = FinishRequest['kind'];

/** The one-line summary of a request, in words ("Best 50 of 1000"). */
export function finishSummaryLine(summary: FinishSummary, request: FinishRequest): string {
  const t = STRINGS.finishBest;
  if (request.kind === 'all') return t.summaryAll(summary.chosen, summary.of);
  if (request.kind === 'percent') return t.summaryPercent(request.percent, summary.asked, summary.of);
  return t.summaryCount(summary.asked, summary.of);
}

const field = 'mt-1 h-10 w-32 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-input)] px-2 text-sm text-[var(--text-primary)]';

/**
 * Finish best: say how many ("best 50", "best 10%", "all"), see what that means before anything runs, then start.
 * It only chooses; the batch runs through the Tasks panel on this device and nothing is uploaded.
 */
export default function FinishBestDialog(props: FinishBestDialogProps) {
  // Mounted only while open, so each opening starts fresh from the right defaults and the focus trap finds its field.
  return props.open ? <FinishBestChooser {...props} /> : null;
}

function FinishBestChooser({ open, plan, version, onStart, onClose }: FinishBestDialogProps) {
  const t = STRINGS.finishBest;
  // It starts from 50 photos or 10%, whichever is smaller for this project, worked out before the first render so the
  // right field is there when focus moves in (a field that swaps afterwards would drop focus to the page).
  const [start] = useState(() => defaultFinishRequest(plan({ kind: 'all' }).summary.of));
  const [mode, setMode] = useState<Mode>(start.kind === 'percent' ? 'percent' : 'count');
  const [count, setCount] = useState(String(start.kind === 'count' ? start.count : FINISH_DEFAULT_COUNT));
  const [percent, setPercent] = useState(String(start.kind === 'percent' ? start.percent : FINISH_DEFAULT_PERCENT));
  const dialogRef = useRef<HTMLElement>(null);
  const first = useRef<HTMLInputElement>(null);
  useFocusTrap(open, dialogRef, onClose, first);

  const request: FinishRequest | null = useMemo(() => {
    if (mode === 'all') return { kind: 'all' };
    if (mode === 'count') {
      const n = Number(count);
      return Number.isInteger(n) && n >= 1 && n <= FINISH_MAX_COUNT ? { kind: 'count', count: n } : null;
    }
    const p = Number(percent);
    return Number.isFinite(p) && p > 0 && p <= 100 ? { kind: 'percent', percent: p } : null;
  }, [mode, count, percent]);
  const result = useMemo(() => (open && request ? plan(request) : null), [open, request, plan, version]);
  const summary = result?.summary;
  const skips = summary ? [
    summary.edited ? t.skipEdited(summary.edited) : '',
    summary.rejected ? t.skipRejected(summary.rejected) : '',
    summary.editedElsewhere ? t.skipElsewhere(summary.editedElsewhere) : '',
    summary.unranked && summary.kind !== 'all' ? t.unranked(summary.unranked) : '',
  ].filter(Boolean) : [];
  const chosen = result?.items.length ?? 0;
  const rawCount = result?.items.filter((frame) => isRawPreviewFile(frame.filename)).length ?? 0;
  const modeButton = (value: Mode, label: string) => (
    <label key={value} className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm">
      <input type="radio" name="finish-mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="h-4 w-4 accent-[var(--brand-accent)]" />
      <span>{label}</span>
    </label>
  );

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="v2-finish-title" data-testid="finish-best-dialog"
        className="flex max-h-[90dvh] w-full max-w-md flex-col overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 text-[var(--text-primary)] shadow-[var(--shadow-panel)]">
        <h2 id="v2-finish-title" className="text-base font-semibold">{t.heading}</h2>
        <p className="mt-2 text-xs text-[var(--text-secondary)]">{t.intro}</p>
        <fieldset className="mt-3">
          <legend className="sr-only">{t.heading}</legend>
          <div className="flex flex-wrap gap-x-4">
            {modeButton('count', t.modes.count)}
            {modeButton('percent', t.modes.percent)}
            {modeButton('all', t.modes.all)}
          </div>
        </fieldset>
        {mode === 'count' && (
          <label className="mt-2 block text-sm">
            <span>{t.number}</span><br />
            <input ref={first} type="number" inputMode="numeric" min={1} max={FINISH_MAX_COUNT} step={1} value={count} data-testid="finish-count"
              onChange={(event) => setCount(event.target.value)} className={field} />
          </label>
        )}
        {mode === 'percent' && (
          <label className="mt-2 block text-sm">
            <span>{t.percentage}</span><br />
            <input ref={first} type="number" inputMode="decimal" min={1} max={100} step={1} value={percent} data-testid="finish-percent"
              onChange={(event) => setPercent(event.target.value)} className={field} />
          </label>
        )}
        {/* Said in words and announced as it changes. */}
        <div role="status" aria-live="polite" data-testid="finish-summary" className="mt-3 text-sm">
          {summary && request ? (
            <>
              <p className="font-semibold">{finishSummaryLine(summary, request)}</p>
              {skips.map((line) => <p key={line} className="text-xs text-[var(--text-secondary)]">{line}</p>)}
              {chosen === 0 && <p className="mt-1 text-xs">{t.nothing}</p>}
            </>
          ) : null}
        </div>
        {rawCount > 0 && <p data-testid="finish-raw-note" className="mt-2 text-xs text-[var(--text-secondary)]">{t.rawNote}</p>}
        <p className="mt-3 text-xs text-[var(--text-secondary)]">{t.onDevice}</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-10 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-sm font-semibold hover:bg-[var(--bg-surface-hover)]">{t.cancel}</button>
          <button type="button" data-testid="finish-start" disabled={chosen === 0} onClick={() => { if (request) { onStart(request); onClose(); } }}
            className="min-h-10 rounded-[var(--radius-sm)] bg-[var(--brand-accent)] px-3 text-sm font-semibold text-[var(--text-on-accent)] hover:bg-[var(--brand-accent-hover)] disabled:opacity-50">
            {t.start(chosen)}
          </button>
        </div>
      </section>
    </div>
  );
}

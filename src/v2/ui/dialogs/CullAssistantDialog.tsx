import { useEffect, useMemo, useRef, useState } from 'react';
import type { CullRankingView, CullRuleWhy, CullRulesView } from '../contract';

/**
 * Culling Assistant (x-std-cull-rules, a preview that is off by default). Three rules with live sliders: minimum
 * quality, keep at least N per burst, keep at most N per burst. The list is ranked again on every movement, from the
 * observations the last scan stored (no new scan). Rules only propose keepers from positive evidence: an uncertain
 * photo always stays for review, and nothing here rejects a photo. "Keep these" is one step that Undo takes back.
 *
 * Words: British English only while this is a preview; they move into the V2 i18n area before it is switched on.
 */
const WORDS = {
  title: 'Culling Assistant',
  intro: 'Set the rules and the list re-sorts as you drag. Nothing changes until you choose Keep. Uncertain photos always stay for you to review, and nothing is ever rejected.',
  minQuality: 'Minimum quality',
  keepAtLeast: 'Keep at least, per burst',
  keepAtMost: 'Keep at most, per burst',
  summary: (keep: number, review: number) => `${keep} to keep · ${review} for review`,
  notScanned: (count: number) => `${count} ${count === 1 ? 'photo has' : 'photos have'} not been scanned yet. Run Auto-cull to include ${count === 1 ? 'it' : 'them'}.`,
  nothing: 'No photos have been scanned yet. Run Auto-cull first, then come back to set the rules.',
  keep: (count: number) => (count === 1 ? 'Keep 1 photo' : `Keep ${count} photos`),
  kept: (count: number) => (count === 1 ? 'Kept 1 photo. Undo takes it back.' : `Kept ${count} photos. Undo takes them back.`),
  close: 'Close',
  score: (score: number) => `Score ${score}`,
  burst: 'Burst',
  more: (count: number) => `And ${count} more.`,
  outcome: { keep: 'Keep', review: 'Review', copy: 'Copy' },
  why: {
    meetsQuality: 'Meets the minimum quality',
    burstMinimum: 'Among the best of its burst',
    belowQuality: 'Below the minimum quality',
    burstFull: 'Its burst already has enough keepers',
    uncertain: 'Uncertain, so it stays for you to review',
    copy: 'An exact copy of another photo',
    yourKeep: 'You kept it',
    yourChoice: 'Your own decision, left as it is',
  } satisfies Record<CullRuleWhy, string>,
};

const SHOWN = 200;

interface CullAssistantDialogProps {
  open: boolean;
  rank: (rules: CullRulesView) => CullRankingView;
  onApply: (rules: CullRulesView) => number;
  onClose: () => void;
}

export default function CullAssistantDialog({ open, rank, onApply, onClose }: CullAssistantDialogProps) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const [rules, setRules] = useState<CullRulesView>({ minQuality: 80, keepAtLeast: 1, keepAtMost: 2 });
  const [message, setMessage] = useState('');
  const [version, setVersion] = useState(0);
  // Ranked again on every slider movement; `version` re-reads the catalogue after Keep.
  const ranking = useMemo(() => (open ? rank(rules) : null), [open, rank, rules, version]);

  useEffect(() => {
    if (!open) return;
    setMessage('');
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => { document.removeEventListener('keydown', handleKey, true); previous?.focus(); };
  }, [open, onClose]);

  if (!open || !ranking) return null;

  const set = (field: keyof CullRulesView, value: number) => setRules((current) => {
    const next = { ...current, [field]: value };
    // "At least" never exceeds "at most": moving one carries the other with it.
    if (field === 'keepAtLeast' && next.keepAtMost < value) next.keepAtMost = value;
    if (field === 'keepAtMost' && next.keepAtLeast > value) next.keepAtLeast = value;
    return next;
  });
  const keepCount = ranking.rows.filter((row) => row.outcome === 'keep').length;
  const slider = (field: keyof CullRulesView, label: string, min: number, max: number) => (
    <label className="block text-sm">
      <span className="flex items-center justify-between gap-2">
        <span>{label}</span>
        <output data-testid={`cull-rule-${field}-value`} className="tabular-nums font-semibold">{rules[field]}</output>
      </span>
      <input type="range" min={min} max={max} step={1} value={rules[field]} data-testid={`cull-rule-${field}`}
        aria-label={label} onChange={(event) => set(field, Number(event.target.value))}
        className="mt-1 w-full accent-[var(--brand-accent)]" />
    </label>
  );

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby="v2-cull-assistant-title"
        className="flex max-h-[90dvh] w-full max-w-lg flex-col rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 text-[var(--text-primary)] shadow-[var(--shadow-panel)]">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 id="v2-cull-assistant-title" className="text-base font-semibold">{WORDS.title}</h2>
          <button ref={closeButton} type="button" onClick={onClose}
            className="min-h-10 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-sm">{WORDS.close}</button>
        </div>
        <p className="mb-3 text-xs text-[var(--text-secondary)]">{WORDS.intro}</p>
        <div className="space-y-3">
          {slider('minQuality', WORDS.minQuality, 0, 100)}
          {slider('keepAtLeast', WORDS.keepAtLeast, 0, 10)}
          {slider('keepAtMost', WORDS.keepAtMost, 1, 10)}
        </div>
        <p role="status" data-testid="cull-rules-summary" className="mt-3 text-sm font-semibold">
          {ranking.rows.length ? WORDS.summary(keepCount, ranking.rows.length - keepCount) : WORDS.nothing}
        </p>
        {ranking.notScanned > 0 && ranking.rows.length > 0 && <p className="text-xs text-[var(--text-secondary)]">{WORDS.notScanned(ranking.notScanned)}</p>}
        <ol aria-label={WORDS.title} data-testid="cull-rules-list" className="mt-2 min-h-0 flex-1 divide-y divide-[var(--border-default)] overflow-y-auto">
          {ranking.rows.slice(0, SHOWN).map((row) => (
            <li key={row.photoId} data-outcome={row.outcome} className="flex items-center justify-between gap-3 py-1.5">
              <div className="min-w-0">
                <p className="truncate text-sm">{row.filename}</p>
                <p className="text-xs text-[var(--text-secondary)]">{WORDS.score(row.score)}{row.burst ? ` · ${WORDS.burst}` : ''} · {WORDS.why[row.why]}</p>
              </div>
              {/* The outcome is a word, never a colour alone. */}
              <span className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2 py-0.5 text-xs font-semibold">{WORDS.outcome[row.outcome]}</span>
            </li>
          ))}
        </ol>
        {ranking.rows.length > SHOWN && <p className="text-xs text-[var(--text-secondary)]">{WORDS.more(ranking.rows.length - SHOWN)}</p>}
        {message && <p role="status" className="mt-2 text-sm">{message}</p>}
        <div className="mt-3 flex justify-end">
          <button type="button" disabled={ranking.newKeepers === 0} data-testid="cull-rules-apply"
            onClick={() => { const kept = onApply(rules); setMessage(WORDS.kept(kept)); setVersion((v) => v + 1); }}
            className="min-h-10 rounded-[var(--radius-sm)] bg-[var(--brand-accent)] px-4 text-sm font-semibold text-[var(--text-on-accent)] disabled:opacity-50">
            {WORDS.keep(ranking.newKeepers)}
          </button>
        </div>
      </section>
    </div>
  );
}

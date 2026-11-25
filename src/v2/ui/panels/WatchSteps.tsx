import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AssistSuggestion, EditRecipe } from '../contract';
import { STRINGS } from '../strings';
import { engineText } from '../../../i18n/areas/engine';
import { previewAfterSteps, readableValue, watchStepsFor } from '../utils/watchSteps';

interface WatchStepsProps {
  suggestion: AssistSuggestion;
  /** The photo's current settings, to say where each setting starts from. */
  current: EditRecipe | undefined;
  /** Shows a recipe change on the photo without applying it (the Look preview path). Null clears it. */
  onPreview: (delta: Partial<EditRecipe> | null) => void;
  onApply: () => void;
  onClose: () => void;
}

/**
 * Watch: an Auto suggestion played one step at a time, in the usual working order, each step said in plain words with
 * its real values. The photo shows the result so far as a preview only; nothing is applied until Apply. Steps move only
 * when the person asks (no timer, no animation), so it suits Reduce motion and screen readers alike. Arrow keys step,
 * Escape stops.
 */
export default function WatchSteps({ suggestion, current, onPreview, onApply, onClose }: WatchStepsProps) {
  const t = STRINGS.watch;
  const steps = useMemo(() => watchStepsFor(suggestion.recipeDelta, current, suggestion.steps), [suggestion, current]);
  const [shown, setShown] = useState(steps.length ? 1 : 0);
  const nextRef = useRef<HTMLButtonElement>(null);
  const done = shown >= steps.length;

  // Focus starts on Next and follows it when Next becomes Watch again at the end, so the keyboard is never lost.
  useEffect(() => { nextRef.current?.focus(); }, [done]);
  useEffect(() => { onPreview(previewAfterSteps(steps, suggestion.recipeDelta, shown)); }, [steps, suggestion.recipeDelta, shown, onPreview]);
  useEffect(() => () => onPreview(null), [onPreview]);

  const step = steps[Math.max(0, shown - 1)];
  const words = { on: t.on, off: t.off, changed: t.changed };
  const names = engineText.steps as Record<string, string>;
  const label = step ? names[step.key] ?? t.otherSetting : '';
  const from = step ? readableValue((current as Record<string, unknown> | undefined)?.[step.key], words) : '';
  const to = step ? readableValue((suggestion.recipeDelta as Record<string, unknown>)[step.key], words) : '';
  const fromTo = step && step.previewable ? `${label}: ${from} → ${to}` : label;

  const go = (count: number) => setShown(Math.max(1, Math.min(steps.length, count)));
  // While focus is in the player the arrow keys step it: they must not also move to the next photo (an app shortcut).
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); go(shown + 1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); event.stopPropagation(); go(shown - 1); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
  };
  const button = 'inline-flex min-h-9 items-center rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2.5 text-[0.6875rem] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] disabled:cursor-not-allowed disabled:opacity-40';

  if (!steps.length) return null;
  return (
    <div role="group" aria-label={t.region} onKeyDown={onKeyDown} data-testid="watch-steps"
      className="mt-2 space-y-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5">
      <div aria-live="polite" className="space-y-1">
        <p className="text-[0.6875rem] font-semibold text-[var(--text-primary)]" data-testid="watch-step-count">{t.stepOf(shown, steps.length)}</p>
        {step && <p className="text-xs font-medium text-[var(--text-primary)]" data-testid="watch-step-value">{fromTo}</p>}
        {step && <p className="text-[0.6875rem] leading-snug text-[var(--text-secondary)]">{t.why[step.group]}</p>}
        {done && <p className="text-[0.6875rem] leading-snug text-[var(--text-secondary)]" data-testid="watch-done">{t.done}</p>}
      </div>
      <p className="text-[0.625rem] text-[var(--text-muted)]">{t.previewNote}</p>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={button} disabled={shown <= 1} onClick={() => go(shown - 1)}>{t.back}</button>
        {!done && <button ref={nextRef} type="button" className={button} onClick={() => go(shown + 1)}>{t.next}</button>}
        {!done && <button type="button" className={button} onClick={() => go(steps.length)}>{t.skip}</button>}
        {done && <button ref={nextRef} type="button" className={button} onClick={() => go(1)}>{t.replay}</button>}
        <button type="button" className={`${button} border-transparent bg-[var(--brand-accent)] text-[var(--text-on-accent)] hover:bg-[var(--brand-accent-hover)]`}
          disabled={suggestion.applied} onClick={() => { onPreview(null); onApply(); onClose(); }}>{STRINGS.copilot.applySingle}</button>
        <button type="button" className={button} onClick={onClose}>{t.stop}</button>
      </div>
    </div>
  );
}

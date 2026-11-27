import React from 'react';
import { CLOUD_EDITS_CHOICES, cloudEditsAllowance, type CloudEditsChoice } from '../../../core/cloudEditsChoice';
import type { CloudConsentAnswer } from '../../../core/cloudConsent';
import { CloudJobError } from '../../../core/cloudJobProblem';
import { STRINGS } from '../strings';

/** The choices, as one labelled group. Used here and in the create-project dialog. */
export function CloudEditsChoicePicker({ name, value, onChange, disabled }: { name: string; value: CloudEditsChoice; onChange: (choice: CloudEditsChoice) => void; disabled?: boolean }) {
  const t = STRINGS.cloudEdits;
  return (
    <fieldset data-testid="cloud-edits-choice" className="space-y-1.5">
      <legend className="text-xs font-semibold text-[var(--text-primary)]">{t.useFor}</legend>
      <p className="text-[0.6875rem] leading-snug text-[var(--text-muted)]">{t.runsAndDeletes}</p>
      <div className="flex flex-wrap gap-1.5">
        {CLOUD_EDITS_CHOICES.map((choice) => (
          <label key={choice} className={`inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 text-xs ${value === choice
            ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] font-semibold text-[var(--text-primary)]'
            : 'border-[var(--border-default)] text-[var(--text-secondary)]'} focus-within:outline focus-within:outline-2 focus-within:outline-[var(--brand-accent)]`}>
            <input type="radio" name={name} value={choice} checked={value === choice} disabled={disabled} onChange={() => onChange(choice)} className="h-3 w-3" />
            <span>{t.choices[choice]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export interface CloudEditsProjectCardProps {
  view: { choice: CloudEditsChoice; covered: number; toDo: number; running: boolean };
  onSetChoice: (choice: CloudEditsChoice) => void;
  onRun: () => Promise<string>;
  consent: () => CloudConsentAnswer;
  onSetConsent: (answer: 'yes' | 'no' | 'ask') => CloudConsentAnswer;
  /** The account's own numbers for this month, as Settings › Account shows them. Absent: no estimate is made. */
  usage?: { used: number; monthly: number };
  onTopUp?: () => void;
  /** Only the one-time question, for the main view while it is unanswered. */
  askOnly?: boolean;
}

const button = 'min-h-9 rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-50';

/**
 * Cloud edits for the whole project (Dave, 27 Nov): which photos, how many that is against the month, and one run. It is
 * processing, not storage: a copy of each chosen photo goes up, edit settings come back, the copy is deleted. The
 * person is asked once, in context, and nothing is ticked for them.
 */
export default function CloudEditsProjectCard({ view, onSetChoice, onRun, consent, onSetConsent, usage, onTopUp, askOnly }: CloudEditsProjectCardProps) {
  const t = STRINGS.cloudEdits;
  const [answer, setAnswer] = React.useState<CloudConsentAnswer>(consent);
  const [message, setMessage] = React.useState('');
  const [needsTopUp, setNeedsTopUp] = React.useState(false);
  const allowance = cloudEditsAllowance(view.toDo, usage);
  const run = async () => {
    setMessage(''); setNeedsTopUp(false);
    try { setMessage(await onRun()); } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : STRINGS.cloudResult.taskFailed);
      setNeedsTopUp(reason instanceof CloudJobError && reason.problem.topUp && Boolean(onTopUp));
    }
  };
  const answerConsent = (yes: boolean) => setAnswer(onSetConsent(yes ? 'yes' : 'no'));
  const ask = view.choice !== 'none' && answer !== 'yes' && answer !== 'no' && (
    <div role="group" aria-labelledby="cloud-edits-consent-question" data-testid="cloud-edits-consent" className="space-y-2 rounded-[var(--radius-md)] border border-[var(--border-default)] p-3">
      <p id="cloud-edits-consent-question" className="text-xs font-semibold text-[var(--text-primary)]">{t.consentQuestion}</p>
      <p className="text-[0.6875rem] leading-relaxed text-[var(--text-secondary)]">{t.consentBody}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => answerConsent(true)} className={button}>{t.consentYes}</button>
        <button type="button" onClick={() => answerConsent(false)} className={button}>{t.consentNo}</button>
      </div>
    </div>
  );
  if (askOnly) return ask || null;
  return (
    <section aria-labelledby="cloud-edits-heading" data-testid="cloud-edits-project" className="space-y-2.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3.5">
      <h3 id="cloud-edits-heading" className="text-xs font-semibold text-[var(--text-primary)]">{t.heading}</h3>
      <CloudEditsChoicePicker name="project-cloud-edits" value={view.choice} onChange={onSetChoice} disabled={view.running} />
      {view.choice !== 'none' && (
        <>
          <p data-testid="cloud-edits-count" className="text-[0.6875rem] text-[var(--text-primary)]">
            {t.toDo(view.toDo, view.covered)}
            {allowance.monthly !== undefined && view.toDo > 0 && <> · {t.allowance(allowance.count, allowance.monthly)}</>}
          </p>
          {allowance.over > 0 && <p data-testid="cloud-edits-over" className="text-[0.6875rem] text-[var(--text-secondary)]">{t.over(allowance.over)}</p>}
          {ask}
          {answer === 'no' && (
            <p className="text-[0.6875rem] text-[var(--text-secondary)]">
              {t.keptOnDevice}{' '}
              <button type="button" onClick={() => setAnswer(onSetConsent('ask'))} className="underline">{t.askAgain}</button>
            </p>
          )}
          {answer === 'yes' && (
            <button type="button" data-testid="cloud-edits-run" disabled={view.running || view.toDo === 0} aria-busy={view.running} onClick={() => { void run(); }} className={button}>
              {view.running ? t.running : t.run(view.toDo)}
            </button>
          )}
        </>
      )}
      {message && <p role="status" aria-live="polite" data-testid="cloud-edits-message" className="text-[0.6875rem] text-[var(--text-secondary)]">{message}</p>}
      {needsTopUp && onTopUp && <button type="button" onClick={onTopUp} className={button}>{t.topUp}</button>}
    </section>
  );
}

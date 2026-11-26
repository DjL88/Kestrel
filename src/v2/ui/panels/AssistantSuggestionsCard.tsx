import React from 'react';
import type { AssistantSuggestionsView } from '../contract';
import { aiReviewText } from '../../../i18n/areas/aiReview';

const t = aiReviewText.assistant;
const button = 'inline-flex h-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 text-xs font-medium text-[var(--text-primary)]';

/** Suggestions an AI assistant left through InFlight's MCP tool, in words, with the reason for each. Nothing changes until Apply. */
export default function AssistantSuggestionsCard({ view, onApply, onDismiss }: {
  view: AssistantSuggestionsView; onApply?: (name: string) => void; onDismiss?: (name: string) => void;
}) {
  return (
    <section aria-label={t.title} data-testid="v2-assistant-suggestions" className="space-y-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3.5">
      <h3 className="text-xs font-semibold text-[var(--text-primary)]">{t.title}</h3>
      <p className="text-[0.6875rem] leading-relaxed text-[var(--text-secondary)]">{view.intro}</p>
      <ul className="space-y-1.5">
        {view.lines.map((line, index) => (
          <li key={index} className="text-xs text-[var(--text-primary)]">
            <span className="font-semibold">{line.photo}</span>: {line.change}
            <span className="block text-[0.6875rem] text-[var(--text-secondary)]">{t.why}: {line.reason}</span>
          </li>
        ))}
      </ul>
      {view.more && <p className="text-[0.6875rem] text-[var(--text-muted)]">{view.more}</p>}
      <div className="flex flex-wrap gap-2">
        {view.lines.length > 0 && <button type="button" className={button} onClick={() => onApply?.(view.name)} data-testid="v2-assistant-apply">{t.apply}</button>}
        <button type="button" className={button} onClick={() => onDismiss?.(view.name)}>{t.dismiss}</button>
      </div>
    </section>
  );
}

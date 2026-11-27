import React from 'react';
import type { ColourFix, ColourIssue, ColourVerdict } from '../../../core/colourVerdict';
import type { ColourWords } from '../../engineClient/colourWords';
import { STRINGS } from '../strings';
import ColourWordsList from './ColourWordsList';

/**
 * Colour-vision support, as one plain line (Dave, a colour-blind user, 27 Nov: "I just want 'Colours look normal' or
 * 'Colours look over-saturated, click here to correct'"). One verdict, at most one action. Correct makes one undoable
 * adjustment and says what it did. Everything else (other findings, the colour names, the outlines) waits behind More
 * and Show where. Said in words, never by colour alone.
 */
export interface ColourVerdictLineProps {
  photoId: string;
  /** Absent until the photo's colours have been measured: the line then says it is not sure. */
  verdict?: ColourVerdict;
  words?: ColourWords;
  /** Makes the one adjustment as a named, undoable edit. Absent when the photo cannot be edited: no Correct button. */
  onCorrect?: (photoId: string, fix: ColourFix) => void;
  onUndo?: () => void;
  /** Red and green areas can be outlined on this photo. */
  canShowWhere?: boolean;
  showingWhere?: boolean;
  onToggleWhere?: () => void;
}

const MINUS = '−';
const said = (fix: ColourFix) => `${STRINGS.history.sliders[fix.setting]} ${fix.delta < 0 ? MINUS : '+'}${Math.abs(fix.delta)}`;
const action = 'inline-flex min-h-8 shrink-0 items-center rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)]';

export default function ColourVerdictLine({ photoId, verdict, words, onCorrect, onUndo, canShowWhere, showingWhere, onToggleWhere }: ColourVerdictLineProps) {
  const t = STRINGS.colourVerdict;
  /** What Correct last did on this photo, so it can be said and undone. */
  const [did, setDid] = React.useState<ColourFix | null>(null);
  React.useEffect(() => setDid(null), [photoId]);
  const shown: ColourVerdict = verdict ?? { kind: 'unsure', more: [] };

  const row = (issue: ColourIssue, lead: boolean) => (
    <div key={issue.kind} data-testid={lead ? 'colour-verdict' : 'colour-verdict-more-item'} data-verdict={issue.kind} className="flex flex-wrap items-center justify-between gap-2">
      <p className={lead ? 'text-sm font-semibold text-[var(--text-primary)]' : 'text-xs text-[var(--text-primary)]'}>{t.kinds[issue.kind]}</p>
      {issue.fix && onCorrect && (
        // The button says what it will change before it is pressed.
        <button type="button" data-testid="colour-verdict-correct" title={t.willChange(said(issue.fix))} aria-label={`${t.correct}: ${said(issue.fix)}`}
          onClick={() => { onCorrect(photoId, issue.fix!); setDid(issue.fix!); }} className={action}>
          {t.correct} <span className="ml-1.5 font-mono font-normal tabular-nums text-[var(--text-secondary)]">{said(issue.fix)}</span>
        </button>
      )}
      {issue.kind === 'redGreenAlike' && canShowWhere && onToggleWhere && (
        <button type="button" data-testid="colour-verdict-where" aria-pressed={Boolean(showingWhere)} onClick={onToggleWhere} className={action}>
          {showingWhere ? t.hideWhere : t.showWhere}
        </button>
      )}
    </div>
  );

  return (
    <section aria-label={STRINGS.settings.assistance.cvdLabel} data-testid="colour-verdict-block" className="space-y-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2.5">
      {row(shown, true)}
      {did && (
        <p role="status" data-testid="colour-verdict-did" className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
          <span className="font-mono tabular-nums text-[var(--text-primary)]">{said(did)}</span>
          {onUndo && <button type="button" onClick={() => { onUndo(); setDid(null); }} className="underline">{t.undo}</button>}
        </p>
      )}
      {(shown.more.length > 0 || words) && (
        <details data-testid="colour-verdict-more" className="text-xs">
          <summary className="cursor-pointer text-[var(--text-secondary)]">{t.more}</summary>
          <div className="mt-2 space-y-2">
            {shown.more.map((issue) => row(issue, false))}
            {words && <ColourWordsList words={words} />}
          </div>
        </details>
      )}
    </section>
  );
}

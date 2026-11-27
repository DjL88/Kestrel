import React from 'react';
import type { ColourSenseNote } from '../../engineClient/colourWords';
import { colourText as t } from '../../../i18n/areas/colour';

/**
 * ColourSense or colour match for one suggestion, in words. A change or a mismatch is always said; that the colour was kept or matches is said
 * only to people who turned on Colour-vision support, to keep the panel calm for everyone else. A shape beside the
 * words marks which it is, so nothing depends on colour. When the subject's colour moved warmer or cooler and `onFix`
 * is given, one button nudges the warmth back; it is an ordinary edit, so Undo and Edit history take it back.
 */
export default function ColourSenseLine({ note, cvdGuidance, testId = 'colour-sense', onFix }: {
  note?: ColourSenseNote; cvdGuidance: boolean; testId?: string; onFix?: (direction: 'cooler' | 'warmer') => void;
}) {
  const [fixed, setFixed] = React.useState(false);
  if (!note || (note.kept && !cvdGuidance)) return null;
  const fix = note.fix;
  return (
    <div className="mt-1.5 space-y-1">
      <p data-testid={testId} data-kept={note.kept} className="flex gap-1.5 text-[0.6875rem] leading-snug text-[var(--text-secondary)]">
        <span aria-hidden="true" className="shrink-0 text-[var(--text-primary)]">{note.kept ? '●' : '▲'}</span>
        <span><strong className="font-semibold text-[var(--text-primary)]">{note.label}</strong> {note.text}</span>
      </p>
      {fix && onFix && (fixed
        ? <p role="status" data-testid={`${testId}-fixed`} className="pl-4 text-[0.6875rem] text-[var(--text-secondary)]">{t.fixApplied}</p>
        : (
          <button type="button" data-testid={`${testId}-fix`} onClick={() => { onFix(fix); setFixed(true); }}
            className="ml-4 rounded-[var(--radius-xs)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-2 py-0.5 text-[0.6875rem] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">
            {fix === 'cooler' ? t.fixCooler : t.fixWarmer}
          </button>
        ))}
    </div>
  );
}

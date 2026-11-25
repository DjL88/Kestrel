import React from 'react';
import type { ColourSenseNote } from '../../engineClient/colourWords';

/**
 * ColourSense or colour match for one suggestion, in words. A change or a mismatch is always said; that the colour was kept or matches is said
 * only to people who turned on Colour-vision support, to keep the panel calm for everyone else. A shape beside the
 * words marks which it is, so nothing depends on colour.
 */
export default function ColourSenseLine({ note, cvdGuidance, testId = 'colour-sense' }: { note?: ColourSenseNote; cvdGuidance: boolean; testId?: string }) {
  if (!note || (note.kept && !cvdGuidance)) return null;
  return (
    <p data-testid={testId} data-kept={note.kept} className="mt-1.5 flex gap-1.5 text-[0.6875rem] leading-snug text-[var(--text-secondary)]">
      <span aria-hidden="true" className="shrink-0 text-[var(--text-primary)]">{note.kept ? '●' : '▲'}</span>
      <span><strong className="font-semibold text-[var(--text-primary)]">{note.label}</strong> {note.text}</span>
    </p>
  );
}

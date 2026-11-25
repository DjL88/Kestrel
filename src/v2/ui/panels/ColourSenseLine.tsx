import React from 'react';
import type { ColourSenseNote } from '../../engineClient/colourWords';

/**
 * ColourSense for one suggestion, in words. A change to the subject's colour is always said; that it was kept is said
 * only to people who turned on Colour-vision support, to keep the panel calm for everyone else. A shape beside the
 * words marks which it is, so nothing depends on colour.
 */
export default function ColourSenseLine({ note, cvdGuidance }: { note?: ColourSenseNote; cvdGuidance: boolean }) {
  if (!note || (note.kept && !cvdGuidance)) return null;
  return (
    <p data-testid="colour-sense" data-kept={note.kept} className="mt-1.5 flex gap-1.5 text-[0.6875rem] leading-snug text-[var(--text-secondary)]">
      <span aria-hidden="true" className="shrink-0 text-[var(--text-primary)]">{note.kept ? '●' : '▲'}</span>
      <span><strong className="font-semibold text-[var(--text-primary)]">{note.label}</strong> {note.text}</span>
    </p>
  );
}

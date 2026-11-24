import React from 'react';
import type { ColourWords } from '../../engineClient/colourWords';
import { colourText as t } from '../../../i18n/areas/colour';

/** A different shape for each kind of note, beside its word, so nothing depends on colour. */
const SHAPE = { warning: '▲', tip: '◆', info: '●' } as const;

/**
 * The colour check in words, for people who turned on Colour-vision support: the main colours by name and each finding
 * as a sentence. Measured on this device from the photo's preview pixels.
 */
export default function ColourWordsList({ words }: { words: ColourWords }) {
  return (
    <div data-testid="colour-words" className="space-y-2 border-t border-[var(--border-subtle)] pt-2">
      {words.palette.length > 0 && (
        <div>
          <p className="text-[0.6875rem] font-semibold text-[var(--text-primary)]">{t.mainColours}</p>
          <ul className="mt-1 space-y-0.5 text-[0.6875rem] leading-relaxed text-[var(--text-secondary)]">
            {words.palette.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      )}
      {words.notes.length > 0 ? (
        <ul className="space-y-1.5 text-[0.6875rem] leading-relaxed text-[var(--text-secondary)]">
          {words.notes.map((note) => (
            <li key={`${note.severity}-${note.text}`} className="flex gap-1.5">
              <span aria-hidden="true" className="shrink-0 text-[var(--text-primary)]">{SHAPE[note.severity]}</span>
              <span><strong className="font-semibold text-[var(--text-primary)]">{note.label}</strong> {note.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[0.6875rem] leading-relaxed text-[var(--text-secondary)]">{t.nothingToFix}</p>
      )}
    </div>
  );
}

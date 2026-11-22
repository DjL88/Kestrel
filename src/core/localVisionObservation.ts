/**
 * What the local vision model says about a photo is only ever an observation to be read by a person. It is never run, fetched,
 * rendered as markup or turned into an edit by itself (#703). This keeps it to short, plain, safe text and drops anything else.
 */
export interface VisionObservation {
  /** Plain British-English sentences, at most `MAX_TEXT` characters. */
  text: string;
  /** The model said nothing usable: the app must then say nothing, not guess. */
  usable: boolean;
}

export const MAX_TEXT = 400;

/** Control, invisible and direction-changing characters can hide text from a reader, so they become spaces. */
const isHidden = (code: number) =>
  code < 0x20 || (code >= 0x7f && code <= 0x9f) || (code >= 0x200b && code <= 0x200f) || (code >= 0x2028 && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);

export function sanitiseObservation(raw: unknown): VisionObservation {
  if (typeof raw !== 'string') return { text: '', usable: false };
  const visible = Array.from(raw, (char) => (isHidden(char.codePointAt(0) ?? 0) ? ' ' : char)).join('');
  const plain = visible
    .replace(/<[^>]*>/g, ' ')
    .replace(/(?:https?|ftp|file|data|javascript):\S*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length < 8 || !/[a-z]/i.test(plain)) return { text: '', usable: false };
  if (plain.length <= MAX_TEXT) return { text: plain, usable: true };
  // Cut at the last full stop that fits, so a sentence is never left half said.
  const cut = plain.slice(0, MAX_TEXT);
  const stop = cut.lastIndexOf('.');
  return { text: stop > 40 ? cut.slice(0, stop + 1) : `${cut.trimEnd()}…`, usable: true };
}

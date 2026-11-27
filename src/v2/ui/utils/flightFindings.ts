/**
 * The Flight panel's findings as short points (Dave, 27 Nov: the tab was "too wordy"): the first sentence of each note,
 * one line each. The full notes stay under "More checks". Nothing is reworded or invented: a point is the note's own
 * opening sentence, and an empty note gives no point.
 */
const LONGEST = 110;

export function firstSentence(note: string | undefined | null): string {
  const text = (note ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  // A full stop, question mark or exclamation mark followed by a space ends the sentence; "f/2.8" and "1.4×" do not.
  const end = text.search(/[.!?](?=\s+\S)/);
  const sentence = end < 0 ? text : text.slice(0, end + 1);
  if (sentence.length <= LONGEST) return sentence;
  const cut = sentence.slice(0, LONGEST);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 40)).replace(/[,;:\s]+$/, '')}…`;
}

export function flightFindings(notes: readonly (string | undefined | null)[]): string[] {
  const points: string[] = [];
  for (const note of notes) {
    const point = firstSentence(note);
    if (point && !points.includes(point)) points.push(point);
  }
  return points;
}

/**
 * A second opinion, in words, on the colour grade of a photo the person has already finished editing.
 *
 * This is deliberately small and never authoritative. The on-device, measured Colour Confidence check
 * (src/core/colourCheck.ts) is the thing InFlight trusts: it works from the actual pixels, offline, and its
 * numbers do not change from one run to the next. This online helper is the opposite in every way that
 * matters - it is a cloud model's plain-English impression of whether a finished edit still looks like a
 * believable photograph, offered alongside the measured check, never in place of it. It cannot change a
 * photo, cannot see or set a slider, and its answer is clamped to a small fixed vocabulary so a model having
 * a strange day cannot put arbitrary text in front of the person.
 *
 * Shared by the control plane (which validates upstream output before it leaves the server) and the app
 * (which validates again before showing anything).
 */

/** A short, closed list of the ways a colour grade can look implausible. Never freeform. */
export type ColourConcern =
  | 'skinTone' // a person's skin reads an unlikely colour
  | 'skyOrFoliage' // sky, water or greenery has taken on a strong, unlikely cast
  | 'clipping' // strong colour has lost detail (flat, poster-like patches)
  | 'oversaturated' // colour generally looks pushed further than a natural photo would be
  | 'flat' // colour has been pulled back until the photo looks washed out
  | 'other';

export const COLOUR_CONCERNS: readonly ColourConcern[] = ['skinTone', 'skyOrFoliage', 'clipping', 'oversaturated', 'flat', 'other'];

export interface ColourVerificationAnswer {
  /** Whether the finished edit still looks like a believable photograph, in the model's plain impression. */
  plausible: boolean;
  /** Up to two concerns, only when `plausible` is false. */
  concerns: ColourConcern[];
  /** One short, plain-English sentence, or null. Never a clinical measurement - that is the measured check's job. */
  note: string | null;
}

export const VERIFY_COLOUR_PROMPT = [
  'You are giving a photographer a second opinion on a photo they have already finished editing, to sit alongside',
  'a separate, measured colour check they already have. Look only at whether the colour grade still looks like a',
  'believable photograph, not whether you personally like it.',
  'plausible: true unless the colours look implausible for a real photo (not merely bold or stylised).',
  'concerns: when plausible is false, up to two of skinTone, skyOrFoliage, clipping, oversaturated, flat, other. Otherwise empty.',
  'note: one short, plain sentence, or null. Never mention or describe any real person beyond "skin tone" in general terms.',
  'Answer in the given JSON form only.',
].join(' ');

export const VERIFY_COLOUR_SCHEMA = {
  type: 'OBJECT',
  properties: {
    plausible: { type: 'BOOLEAN' },
    concerns: { type: 'ARRAY', items: { type: 'STRING', enum: COLOUR_CONCERNS as unknown as string[] } },
    note: { type: 'STRING', nullable: true },
  },
  required: ['plausible'],
} as const;

const isConcern = (value: unknown): value is ColourConcern => typeof value === 'string' && (COLOUR_CONCERNS as readonly string[]).includes(value);

/** A short plain sentence only: no markup, links, or anything long enough to be a different kind of answer. */
function plainNote(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text || text.length > 160 || /[<>{}\\]|https?:|www\.|\.(com|org|net)\b/i.test(text)) return null;
  return text;
}

/**
 * Check the helper's reply and keep only what is safe and bounded, or return null. Tolerates a reply wrapped
 * in a code fence. `plausible: true` always clears `concerns` - a model cannot raise a flag it also said was fine.
 */
export function parseColourVerification(text: string): ColourVerificationAnswer | null {
  let data: unknown;
  try { data = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch { return null; }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (typeof record.plausible !== 'boolean') return null;
  const concerns = record.plausible || !Array.isArray(record.concerns) ? [] : [...new Set(record.concerns.filter(isConcern))].slice(0, 2);
  return { plausible: record.plausible, concerns, note: plainNote(record.note) };
}

import type { PhotoEdit } from './photoEdits';
import type { AutoResult } from './autoEnhance';

/**
 * Up to three reversible treatments for the photo you are looking at (#703): Natural, Subject, Creative.
 * The numbers come from the photo's own measurements (and fixed, small, bounded steps), never from text the vision model wrote:
 * the model's observation can only decide whether a treatment is offered and how it is worded. Applying one is an ordinary edit,
 * so Undo, history and reopening work as for any slider change. "Nothing to change" is a correct answer.
 */
export type TreatmentId = 'natural' | 'subject' | 'creative';
export type Delta = Partial<Pick<PhotoEdit, 'exposure' | 'warmth' | 'colour' | 'brightness' | 'contrast' | 'highlights' | 'shadows' | 'vibrance' | 'texture' | 'clarity' | 'sharpen'>>;

export interface Treatment {
  id: TreatmentId;
  /** The words for the change in plain British English, shown with the button. */
  why: string;
  delta: Delta;
}

const LIMIT = 2;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const DETAIL_KEYS = new Set(['texture', 'clarity', 'sharpen']);
const round = (value: number) => Math.round(value * 100) / 100;

/** Adds a treatment to the current edit with every slider kept inside its range. Pure: the same inputs always give the same edit. */
export function applyTreatment(edit: PhotoEdit, delta: Delta): PhotoEdit {
  const next: PhotoEdit = { ...edit };
  for (const [key, change] of Object.entries(delta) as [keyof Delta, number][]) {
    if (!Number.isFinite(change) || change === 0) continue;
    const current = Number(edit[key] ?? 0);
    next[key] = round(DETAIL_KEYS.has(key) ? clamp(current + change, 0, LIMIT) : clamp(current + change, -LIMIT, LIMIT)) as never;
  }
  return next;
}

/** Words that say there is a living or moving subject worth bringing out. Observation text decides only that, never numbers. */
const SUBJECT_WORDS = /\b(bird|birds|raptor|eagle|hawk|kite|owl|duck|swan|gull|heron|kingfisher|aeroplane|airplane|plane|jet|helicopter|animal|deer|fox|dog|cat|horse|person|man|woman|child|people|butterfly|insect)\b/i;
const WARM_WORDS = /\b(golden|warm|sunset|sunrise|dusk|dawn)\b/i;

export function proposeTreatments(input: { edit: PhotoEdit; measured: AutoResult['edit']; observation?: string }): Treatment[] {
  const { edit, measured } = input;
  const observation = input.observation ?? '';
  const out: Treatment[] = [];

  // Natural: only what the photo's own measurements ask for, minus what is already done.
  const natural: Delta = {};
  for (const key of ['exposure', 'warmth', 'shadows', 'highlights', 'contrast', 'vibrance'] as const) {
    const wanted = clamp(measured[key], -LIMIT, LIMIT);
    const missing = round(wanted - Number(edit[key] ?? 0));
    // Only move toward the measured target, and ignore tiny differences that are not worth a click.
    if (Math.abs(missing) >= 0.1 && Math.sign(missing) === Math.sign(wanted - 0.0001) || (Math.abs(missing) >= 0.1 && wanted === 0 && false)) natural[key] = missing;
  }
  if (Object.keys(natural).length) out.push({ id: 'natural', why: 'Balances the exposure, tones and colour the photo asks for, and nothing more.', delta: natural });

  // Subject: a small, bounded lift in detail, offered when the photo has a subject.
  if (SUBJECT_WORDS.test(observation) && Number(edit.clarity ?? 0) < 0.5 && Number(edit.texture ?? 0) < 0.5) {
    out.push({ id: 'subject', why: 'Brings out fine detail in the subject with a small lift in clarity, texture and sharpening.', delta: { clarity: 0.2, texture: 0.2, sharpen: 0.3 } });
  }

  // Creative: a matter of taste, not a correction, and said so.
  if (WARM_WORDS.test(observation)) out.push({ id: 'creative', why: 'A taste choice, not a correction: a little more warmth and richer colour.', delta: { warmth: 0.25, vibrance: 0.3 } });
  else out.push({ id: 'creative', why: 'A taste choice, not a correction: slightly richer colour with a touch more contrast.', delta: { vibrance: 0.3, contrast: 0.15 } });
  return out;
}

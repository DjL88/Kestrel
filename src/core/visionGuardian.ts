/**
 * Vision AI is the guardian (owner decision 2, 25 Nov 2026). A vision-language model (on device: SmolVLM2 in the desktop
 * app; online and opt-in: Gemini via the gateway) gives a second opinion on a model result before it is shown or applied.
 * It may hold a result for the person's review, and it can never upgrade one: agreement adds nothing, doubt changes
 * nothing, and a single clear "no" is enough to hold it. Pure: no model is run here.
 *
 * Four checks (owner decision 2: subject found, mask complete, species plausible, edit natural). Each is one plain yes/no
 * question in short ASCII; `guardianQuestionText` builds the exact words, and the benchmark (guardianBenchmark.ts,
 * docs/QUALITY-BENCHMARKS.md) asks the model exactly the same words, so what is measured is what the app asks.
 */
export type GuardianVerdict = 'agrees' | 'disagrees' | 'unsure';
/** Most to least automatic. The guardian only ever moves a result down this list. */
export type GuardedStatus = 'apply' | 'suggest' | 'needs-review';
/** `subjectClear` is Auto-cull's keeper check (cullGuardian.ts). It is not one of the four benchmarked checks yet. */
export type GuardianQuestion = 'editNatural' | 'subjectFound' | 'maskComplete' | 'speciesPlausible' | 'subjectClear';
export const GUARDIAN_CHECKS: readonly GuardianQuestion[] = ['editNatural', 'subjectFound', 'maskComplete', 'speciesPlausible'];
export interface GuardianOpinion { source: 'on-device' | 'online'; verdict: GuardianVerdict; question: GuardianQuestion }

/** Short plain ASCII, so the on-device model accepts them (see providers/localVision.ts). */
export const GUARDIAN_QUESTIONS = {
  editNatural: 'Does this photograph look natural, with no strange colours, halos or blotches? Answer yes or no.',
  subjectClear: 'Is the main subject of this photograph clearly visible and sharp? Answer yes or no.',
} as const;

/** Plain ASCII, as the on-device model needs ("Goldcrest" stays, "Škoda" becomes "Skoda"). At most 60 characters. */
export function guardianWord(text: string): string {
  return text.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/[?"]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60).trim();
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an ' : 'a ') + word;

/**
 * The exact question for a check. `subject` is what the result claims: the subject word ("bird", "aircraft") for
 * subjectFound and maskComplete, the common species name for speciesPlausible. The mask checks are asked about a picture
 * in which everything outside the mask is darkened (`darkenOutsideMask`). Null when the claim has no usable words.
 */
export function guardianQuestionText(check: GuardianQuestion, subject?: string): string | null {
  if (check === 'editNatural') return GUARDIAN_QUESTIONS.editNatural;
  if (check === 'subjectClear') return GUARDIAN_QUESTIONS.subjectClear;
  const word = guardianWord(subject ?? '').toLowerCase();
  if (!word) return null;
  if (check === 'subjectFound') return `Is the bright area of this photograph ${article(word)}? Answer yes or no.`;
  if (check === 'maskComplete') return `Is the whole ${word} inside the bright area, with no part of it darkened? Answer yes or no.`;
  return `Is the animal in this photograph ${article(word)}? Answer yes or no.`;
}

/** Outside the mask the picture keeps this share of its brightness. The benchmark's renderer uses the same value. */
export const MASK_OUTSIDE_BRIGHTNESS = 0.25;

/**
 * The picture the mask checks look at: inside the mask unchanged, outside darkened, blended by the mask's own alpha.
 * `rgba` is changed in place; `alpha` has one 0..1 value per pixel. Mirrors crates/kestrel-vision/examples/guardian_eval.rs.
 */
export function darkenOutsideMask(rgba: Uint8ClampedArray, alpha: Float32Array): void {
  if (rgba.length !== alpha.length * 4) throw new Error('Mask and picture sizes differ');
  for (let i = 0; i < alpha.length; i += 1) {
    const keep = MASK_OUTSIDE_BRIGHTNESS + (1 - MASK_OUTSIDE_BRIGHTNESS) * Math.min(1, Math.max(0, alpha[i]));
    const j = i * 4;
    rgba[j] = Math.round(rgba[j] * keep);
    rgba[j + 1] = Math.round(rgba[j + 1] * keep);
    rgba[j + 2] = Math.round(rgba[j + 2] * keep);
  }
}

const RANK: Record<GuardedStatus, number> = { apply: 2, suggest: 1, 'needs-review': 0 };

/** Only a plain yes or a plain no counts. A hedge ("yes, but..."), a refusal or no answer is unsure. */
export function readGuardianAnswer(text: string | undefined): GuardianVerdict {
  const answer = (text ?? '').trim().toLowerCase();
  const first = /^([a-z]+)\b/.exec(answer)?.[1];
  if (first === 'no') return 'disagrees';
  if (first === 'yes') return /\b(but|however|although|though|except|slightly|a little|too)\b/.test(answer) ? 'unsure' : 'agrees';
  return 'unsure';
}

export function guardResult(engine: GuardedStatus, opinions: readonly GuardianOpinion[]): { status: GuardedStatus; heldBy: GuardianOpinion[] } {
  const heldBy = opinions.filter((opinion) => opinion.verdict === 'disagrees');
  const status: GuardedStatus = heldBy.length ? 'needs-review' : engine;
  // Never upgrade: whatever the opinions, the result is at most what the engine decided.
  return { status: RANK[status] <= RANK[engine] ? status : engine, heldBy };
}

/**
 * Vision AI is the guardian (owner decision 2, 25 Nov 2026). A vision-language model (on device: SmolVLM2 in the desktop
 * app; online and opt-in: Gemini via the gateway) gives a second opinion on a model result before it is shown or applied.
 * It may hold a result for the person's review, and it can never upgrade one: agreement adds nothing, doubt changes
 * nothing, and a single clear "no" is enough to hold it. Pure: no model is run here.
 */
export type GuardianVerdict = 'agrees' | 'disagrees' | 'unsure';
/** Most to least automatic. The guardian only ever moves a result down this list. */
export type GuardedStatus = 'apply' | 'suggest' | 'needs-review';
export type GuardianQuestion = keyof typeof GUARDIAN_QUESTIONS;
export interface GuardianOpinion { source: 'on-device' | 'online'; verdict: GuardianVerdict; question: GuardianQuestion }

/** Short plain ASCII, so the on-device model accepts them (see providers/localVision.ts). */
export const GUARDIAN_QUESTIONS = {
  editNatural: 'Does this photograph look natural, with no strange colours, halos or blotches? Answer yes or no.',
  subjectClear: 'Is the main subject of this photograph clearly visible and sharp? Answer yes or no.',
} as const;

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

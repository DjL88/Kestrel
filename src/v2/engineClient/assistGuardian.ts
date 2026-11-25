import { guardResult, type GuardianOpinion } from '../../core/visionGuardian';
import { v2Text } from '../../i18n/areas/v2';
import type { ColourSenseNote } from './colourWords';

/**
 * Vision guardian, slice 2: a second opinion on every Co-pilot and Auto-Edit suggestion, not only before Auto-pilot.
 * The guardian advises only. It never changes a suggestion's values, never removes one and never applies anything. It can:
 * - hold an automatic apply (Auto-pilot, the first-photo quick start) so the edit waits for the person's review;
 * - add one plain line to a suggestion it doubts, so the person can decide. A person's own Apply always applies.
 * Agreement and doubt add nothing (see src/core/visionGuardian.ts: it never upgrades a result).
 */
export interface AssistGuardian {
  /** Candidates still waiting for an answer, in the order they are asked. Empty when every one was asked or no model. */
  pending: string[];
  opinions: Partial<Record<string, GuardianOpinion>>;
}

interface Candidate { id: string; edit: unknown }

/** Auto's own pick first (Auto-pilot and the quick start wait on it), then the others in the order Co-pilot shows them. */
export function guardianOrder<C extends Candidate>(candidates: readonly C[], preferred: unknown): C[] {
  const first = candidates.filter((candidate) => candidate.edit === preferred);
  return [...first, ...candidates.filter((candidate) => candidate.edit !== preferred)];
}

export function startGuardian(order: readonly Candidate[], modelAvailable: boolean): AssistGuardian {
  return { pending: modelAvailable ? order.map((candidate) => candidate.id) : [], opinions: {} };
}

/** Record one answer. No answer (the model was absent or failed) is no opinion: the candidate is settled, nothing held. */
export function withOpinion(guardian: AssistGuardian, candidateId: string, opinion: GuardianOpinion | null): AssistGuardian {
  return {
    pending: guardian.pending.filter((id) => id !== candidateId),
    opinions: opinion ? { ...guardian.opinions, [candidateId]: opinion } : guardian.opinions,
  };
}

/** True once the guardian has answered for this candidate, or will not be asked. Assists from before the guardian count as settled. */
export function guardianSettled(guardian: AssistGuardian | undefined, candidateId: string): boolean {
  return !guardian || !guardian.pending.includes(candidateId);
}

/** Whether an automatic apply of this candidate must wait for the person. Only a clear "no" holds. */
export function guardianHolds(guardian: AssistGuardian | undefined, candidateId: string): boolean {
  const opinion = guardian?.opinions[candidateId];
  return guardResult('apply', opinion ? [opinion] : []).status !== 'apply';
}

/** The line a doubted suggestion carries in Co-pilot and Assist. Nothing for agreement or doubt: they add nothing. */
export function guardianNote(guardian: AssistGuardian | undefined, candidateId: string): ColourSenseNote | undefined {
  if (!guardianHolds(guardian, candidateId)) return undefined;
  return { kept: false, label: v2Text.guardian.secondOpinion, text: v2Text.guardian.suggestionDoubted };
}

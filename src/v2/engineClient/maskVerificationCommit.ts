import type { CourseCorrection } from '../../engine/enhancementVerifier';
import { framingKey } from '../../core/maskTypes';
import type { PhotoFrame } from '../../core/types';
import { readEditGroups } from './editGroupState';

/** Include every part of the context in which a verification actually examined pixels. */
export function maskVerificationKey(projectId: string, frame: PhotoFrame): string {
  return JSON.stringify([projectId, frame.id, frame.stableKey, frame.originalSha256,
    frame.removedAt ?? null, framingKey(frame.framing), readEditGroups(frame).activeId,
    frame.editVersions?.activeId, frame.edit?.masks ?? []]);
}

/**
 * What the mask check tells the person, or null for nothing to say. Advice only: the person's slider values are
 * their decision and are never rewritten by this check (a background rewrite once pulled a deliberate Subject
 * Exposure of -1.5 to nearly 0). A comparison the verifier could not make (strength 0) is not the person's
 * problem, so it says nothing rather than guess.
 */
export function maskAdvice(verification: CourseCorrection): string | null {
  if (verification.ok || verification.suggestedStrengthScale <= 0 || !verification.reasons.length) return null;
  return `A mask's effect may look too strong: ${verification.reasons.join(' ')} Your setting is kept. Lower it if you agree.`;
}

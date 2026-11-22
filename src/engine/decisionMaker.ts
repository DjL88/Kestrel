import type { CullSuggestion } from '../core/autoCull';
import type { Corroboration } from '../core/subjectCorroboration';
import type { PhotoTier } from './types';

/**
 * First real fusion of two previously-separate engines into the owner's "good, better, best" ranking
 * (22 Nov 2026 direction). Both inputs are real, already-shipped signals:
 *  - `cull`: autoCull.ts's pixel-detail + subject-sharpness score and confidence (0-99, high/medium/low).
 *  - `corroboration`: subjectCorroboration.ts's agreement check between the on-device vision scene
 *    reading and the object detector - a real safety signal, not a guess, used here to stop a
 *    photo with a disputed subject (bird vs. aircraft) from being ranked as the shoot's best.
 *
 * Deliberately NOT included yet, so this does not overstate what it ranks on: denoise quality, mask/
 * subject-area composition, and upscale fidelity. None of those engines currently emit a per-photo
 * quality signal this function could use - adding one is a separate, later slice, not a gap in this
 * function's logic.
 *
 * Returns null, not a guessed tier, when the photo has no usable cull evidence yet (not analysed, a
 * duplicate, or an explicit reject) - CLAUDE.md: unknown stays unknown.
 */
export function rankPhoto(cull: CullSuggestion, corroboration?: Corroboration): PhotoTier | null {
  if (cull.decision !== 'keep') return null;
  const conflicted = corroboration?.state === 'conflict';
  if (cull.confidence === 'high' && cull.score >= 85 && !conflicted) return 'best';
  if (cull.score >= 60 || (cull.confidence === 'high' && conflicted)) return 'better';
  return 'good';
}

/** Convenience for a whole shoot: only frames with a usable tier are present in the result. */
export function rankPhotos(
  suggestions: readonly CullSuggestion[],
  corroborationFor: (frameId: string) => Corroboration | undefined = () => undefined,
): Map<string, PhotoTier> {
  const ranked = new Map<string, PhotoTier>();
  for (const cull of suggestions) {
    const tier = rankPhoto(cull, corroborationFor(cull.frameId));
    if (tier) ranked.set(cull.frameId, tier);
  }
  return ranked;
}

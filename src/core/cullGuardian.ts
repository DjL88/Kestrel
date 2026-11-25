import type { CullSuggestion } from './autoCull';
import { guardResult, type GuardianOpinion } from './visionGuardian';

/**
 * Vision AI as the guardian for Auto-Cull (owner decision 2). Auto-pilot now runs Auto-Cull after every import and
 * applies its confident keepers with nobody looking, so before that happens the on-device vision model is asked whether
 * the main subject is clearly visible and sharp. It can only hold a keeper back for the person's review: a clear "no"
 * turns a confident keep into a suggested one (still a keep, never a reject), and agreement, doubt or silence change
 * nothing. Pure: no model is run here.
 */

/** The confident keeps Auto-Cull would apply, strongest first, at most `limit` (each question takes seconds on a laptop). */
export function keepsToGuard(results: readonly CullSuggestion[], limit: number): string[] {
  return results
    .filter((result) => result.decision === 'keep' && result.confidence === 'high')
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, Math.floor(limit)))
    .map((result) => result.frameId);
}

/** A confident keep the guardian clearly doubts drops to a suggested keep, so it waits for the person. Nothing else changes. */
export function holdDoubtedKeeps(results: readonly CullSuggestion[], opinions: ReadonlyMap<string, GuardianOpinion>): { results: CullSuggestion[]; held: string[] } {
  const held: string[] = [];
  const guarded = results.map((result) => {
    if (result.decision !== 'keep' || result.confidence !== 'high') return result;
    const opinion = opinions.get(result.frameId);
    if (guardResult('apply', opinion ? [opinion] : []).status === 'apply') return result;
    held.push(result.frameId);
    return { ...result, confidence: 'medium' as const };
  });
  return { results: guarded, held };
}

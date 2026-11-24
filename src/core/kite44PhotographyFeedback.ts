import { photographyKnowledge, resolvePhotographyGuidance, type PhotographyObservation } from './photographyKnowledge';
import type { PhotoEdit } from './photoEdits';
const keys = ['exposure','warmth','shadows','highlights','contrast','vibrance'] as const;
type Recipe = Partial<Record<typeof keys[number], number>>;
function safeRecipe(edit: PhotoEdit): Recipe {
  const out: Recipe = {};
  for (const key of keys) {
    const value = edit[key];
    if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 100) out[key] = value;
  }
  return out;
}
export interface PhotographyFeedbackInput {
  consent: { shareFeatures: boolean; version: string };
  observations: readonly PhotographyObservation[];
  suggested: PhotoEdit;
  accepted: PhotoEdit;
  outcome: 'accepted' | 'modified' | 'rejected';
}
/** Deliberately no transport, identifiers, image bytes, mask grids, EXIF, paths or free text. */
export function buildPhotographyFeedback(input: PhotographyFeedbackInput) {
  if (input.consent.shareFeatures !== true || input.consent.version !== '1') return null;
  if (!['accepted','modified','rejected'].includes(input.outcome)) return null;
  return {
    schemaVersion: 1,
    consentVersion: '1',
    knowledgeVersion: photographyKnowledge.version,
    ruleIds: resolvePhotographyGuidance(input.observations).rules.map(r => r.id),
    suggested: safeRecipe(input.suggested),
    accepted: safeRecipe(input.accepted),
    outcome: input.outcome,
  };
}

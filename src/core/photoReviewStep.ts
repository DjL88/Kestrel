/**
 * Every visual-model suggestion is a proposal, never a permission to make a
 * dramatic edit. Bound its requested ABSOLUTE slider values to one small step
 * from the current photograph's recipe. The UI must display these *same*
 * targets before its existing, undoable Apply action.
 *
 * This is not a judgement that the model is correct. The photographer still
 * chooses whether to apply; stronger edits remain available manually.
 */
import { PROPOSAL_BOUNDS, type RecipeProposal } from './recipeProposal';
import type { PhotoEdit } from './photoEdits';

export function conservativeReviewTargets(current: PhotoEdit, proposed: RecipeProposal): RecipeProposal {
  const out: RecipeProposal = {};
  for (const key of Object.keys(PROPOSAL_BOUNDS) as (keyof RecipeProposal)[]) {
    const wanted = proposed[key];
    if (typeof wanted !== 'number' || !Number.isFinite(wanted)) continue;
    const before = current[key];
    if (before !== undefined && (typeof before !== 'number' || !Number.isFinite(before))) continue;
    const original = before ?? 0;
    const [minimum, maximum] = PROPOSAL_BOUNDS[key];
    const maxStep = key === 'exposure' ? 0.2 : 0.3;
    const target = Math.max(minimum, Math.min(maximum,
      Math.max(original - maxStep, Math.min(original + maxStep, wanted))));
    const rounded = Math.round(target * 20) / 20;
    if (Math.abs(rounded - original) >= 0.025) out[key] = rounded;
  }
  return out;
}

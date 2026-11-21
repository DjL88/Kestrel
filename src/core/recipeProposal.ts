/**
 * The only thing an AI may return about editing: a few numbers for existing
 * sliders. No pixels, no masks, no file operations. Shared by the control plane
 * (which validates upstream output) and the app (which validates again before
 * showing a proposal for the person to Apply, Keep or Undo).
 */
import { DETAIL_CONTROLS, TONE_CONTROLS, type PhotoEdit } from './photoEdits';

type NumericKey = Exclude<keyof PhotoEdit, 'masks'>;
export type RecipeProposal = Partial<Record<NumericKey, number>>;

/** Allowed range per slider: the same ranges the editor uses. */
export const PROPOSAL_BOUNDS: Readonly<Record<NumericKey, readonly [number, number]>> = Object.freeze({
  exposure: [-2, 2], warmth: [-2, 2], colour: [-2, 2],
  ...Object.fromEntries(TONE_CONTROLS.map(({ key }) => [key, [-2, 2] as const])),
  ...Object.fromEntries(DETAIL_CONTROLS.map(({ key }) => [key, [-2, 2] as const])),
  denoise: [0, 2],
} as unknown as Record<NumericKey, readonly [number, number]>);

export const RECIPE_PROMPT = [
  'You are helping a photographer edit one photo. Suggest small changes to these sliders only, as JSON numbers:',
  `${Object.entries(PROPOSAL_BOUNDS).map(([key, [lo, hi]]) => `${key} (${lo} to ${hi})`).join(', ')}.`,
  'Omit a slider that should not change. If the photo is already well balanced, answer {}. Never describe or name people.',
].join(' ');

/**
 * Keep only known sliders with finite numbers, clamped to range and rounded to
 * 0.05. Returns null for anything that is not a plain object (or not JSON).
 * An empty object means "already balanced".
 */
export function parseRecipeProposal(input: unknown): RecipeProposal | null {
  let data = input;
  if (typeof data === 'string') {
    try { data = JSON.parse(data.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch { return null; }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  const proposal: RecipeProposal = {};
  for (const key of Object.keys(PROPOSAL_BOUNDS) as NumericKey[]) {
    const value = record[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const [lo, hi] = PROPOSAL_BOUNDS[key];
    const clamped = Math.round(Math.min(hi, Math.max(lo, value)) * 20) / 20;
    if (clamped !== 0) proposal[key] = clamped;
  }
  return proposal;
}

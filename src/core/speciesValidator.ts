/**
 * BioCLIP 2 as a second opinion on species (desktop "fine detail" pack and the cloud runner's validator). BioCLIP keeps
 * making the suggestion; BioCLIP 2 (ViT-L/14, a far larger model) ranks the same names independently, and this
 * decides only whether the two agree. Agreement can raise the photographer's confidence; disagreement marks the photo
 * for review and is never applied silently; a validator that is unsure says so. It never replaces a person's choice.
 */
import { pickSuggestions, type SpeciesLabel, type Suggestion } from './speciesMatch';

export type SpeciesVerdict =
  | { kind: 'agrees'; name: string }
  /** The validator prefers another name. Both are shown; the photo is marked for review. */
  | { kind: 'differs'; suggested: string; validator: string }
  /** The validator has no clear answer (nothing stands out), so it neither confirms nor contradicts. */
  | { kind: 'unsure' };

const key = (label: Pick<SpeciesLabel, 'scientific'>) => label.scientific.trim().toLowerCase();

/**
 * `suggested` is BioCLIP's top name (null when it offered none); `validator` is BioCLIP 2's full ranking.
 * Agreement means BioCLIP 2's own top pick is the same species. A suggestion that is only in BioCLIP 2's top three is
 * not agreement: the verdict is 'differs' when BioCLIP 2 clearly prefers another name, else 'unsure'.
 */
export function compareSpecies(suggested: Pick<SpeciesLabel, 'scientific' | 'common'> | null, validator: readonly Suggestion[]): SpeciesVerdict {
  const picks = pickSuggestions(validator);
  if (!picks.length) return { kind: 'unsure' };
  const top = picks[0].label;
  if (!suggested) return { kind: 'unsure' };
  if (key(top) === key(suggested)) return { kind: 'agrees', name: suggested.common };
  return { kind: 'differs', suggested: suggested.common, validator: top.common };
}

/** The validator's labels file: the same names as the app's BioCLIP lists, re-embedded with BioCLIP 2's text half. */
export interface ValidatorLabels { version: number; model: string; dimensions: number; uk: SpeciesLabel[]; world: SpeciesLabel[] }

export function checkValidatorLabels(file: unknown): ValidatorLabels {
  const f = file as Partial<ValidatorLabels> | null;
  if (!f || f.model !== 'bioclip-2' || f.dimensions !== 768 || !Array.isArray(f.uk) || !Array.isArray(f.world) || !f.uk.length) {
    throw new Error('The species validator names are not in the expected format.');
  }
  return f as ValidatorLabels;
}

/**
 * A group of extra names for the validator (world mammals today; reptiles, amphibians, dragonflies, butterflies and moths
 * later): BioCLIP 2 vectors with region codes, filtered by the person's regions the same way as the world birds.
 */
export function checkGroupLabels(file: unknown): SpeciesLabel[] {
  const f = file as { dimensions?: unknown; labels?: unknown } | null;
  if (!f || f.dimensions !== 768 || !Array.isArray(f.labels) || !f.labels.length) {
    throw new Error('The species validator names are not in the expected format.');
  }
  return f.labels as SpeciesLabel[];
}

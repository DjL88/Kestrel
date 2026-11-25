import { rankSpecies, type SpeciesLabel, type Suggestion } from './speciesMatch';
import { addTags, type SubjectKind } from './subjectTags';

/** Tags the app added by itself, and names the user has removed so they are never added again to that photo. */
export interface AutoState {
  autoTags?: string[];
  declinedTags?: string[];
}

export const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const has = (list: readonly string[] | undefined, name: string) => (list ?? []).some((entry) => sameName(entry, name));

/** Only a photo with no tags yet is tagged automatically, and never with a name the user removed from it before. */
export function mayAutoTag(photo: { tags?: readonly string[]; subjectNames?: readonly string[]; subjectDisputed?: boolean } & AutoState, name: string): boolean {
  // When two readings of the photo disagree about what it is, no name is added by itself.
  if (photo.subjectDisputed) return false;
  return !(photo.tags?.length) && !(photo.subjectNames?.length) && !has(photo.declinedTags, name);
}

/** The photo's data after the app adds a name by itself. */
export function applyAutoTag(photo: { tags?: readonly string[] } & AutoState, name: string): { tags: string[]; autoTags: string[] } {
  return { tags: addTags(photo.tags ?? [], [name]), autoTags: addTags(photo.autoTags ?? [], [name]) };
}

/**
 * After the user edits the tag list: automatic tags that are still there stay marked automatic, and any that were taken
 * away are remembered as declined, so the app does not put them back.
 */
export function reconcileAuto(previous: AutoState, nextTags: readonly string[]): Required<AutoState> {
  const kept = (previous.autoTags ?? []).filter((tag) => has(nextTags, tag));
  const removed = (previous.autoTags ?? []).filter((tag) => !has(nextTags, tag));
  return { autoTags: kept, declinedTags: addTags(previous.declinedTags ?? [], removed) };
}

/** The user keeps an automatic tag: it becomes an ordinary tag. */
export function keepAuto(previous: AutoState, name: string): string[] {
  return (previous.autoTags ?? []).filter((tag) => !sameName(tag, name));
}

/** Minimum share of the unpersonalised ranking for automatic tagging. */
export const AUTO_MINIMUM = 0.8;
export const shouldAutoTag = (probability: number, minimum = AUTO_MINIMUM) => probability >= minimum && probability <= 1;

/**
 * The bar for writing a species name by itself, per group: 0.95 for every group. Owner: "aim for 100%, 95% is great".
 * Measured with tools/species/benchmark_score.py on 474 public-domain, CC0 and CC BY Commons photos of 50 UK and European
 * species, through the app's whole path (gate, group, agreement, bar, family), Palearctic lists:
 * - birds (192 photos): at 0.8 with the family at 0.8, 162 names given and 7 wrong (95.7%); at 0.95 with the family at
 *   0.95, 150 names given and 1 wrong (99.3%; a book illustration of a wren named as the tit family);
 * - mammals, insects, reptiles and amphibians (282 photos), already at 0.95: 69 names given and 4 marked wrong, of which
 *   2 were Commons photos filed under another species whose name the app gave correctly (a red kite, a bee-eater).
 * Earlier smaller checks agreed: at 0.8, insects 29 right and 5 wrong, mammals 5 right and 2 wrong.
 */
export const AUTO_MINIMUM_BY_GROUP: Partial<Record<SpeciesLabel['group'], number>> = { bird: 0.95, insect: 0.95, mammal: 0.95, reptile: 0.95, amphibian: 0.95 };
/** The bar for naming a family when no single species reaches its bar: the same 0.95 (at 0.8, 2 of 24 family names were wrong). */
export const FAMILY_MINIMUM = 0.95;
export const autoTagMinimum = (group: SpeciesLabel['group'] | undefined) => (group && AUTO_MINIMUM_BY_GROUP[group]) || AUTO_MINIMUM;

/**
 * The label groups a photo may be named from, by what the category gate saw: an insect is named only from the insect
 * lists, a reptile or amphibian only from theirs. A stag beetle was otherwise named "Black Woodpecker" at 0.89 in the
 * same check. When the gate is not sure (no confident category), every group stays in, as before.
 */
export function speciesGroupsForRoute(categoryId: string | null | undefined): SpeciesLabel['group'][] | null {
  switch (categoryId) {
    case 'bird': case 'bird-of-prey': case 'waterbird': return ['bird'];
    case 'mammal': return ['mammal'];
    case 'reptile': return ['reptile', 'amphibian'];
    case 'insect': return ['insect'];
    default: return null;
  }
}

/**
 * The gate and the species model must agree on the group before a name is written: the best match across every list
 * has to be in the group the gate saw. A squirrel the gate took for a bird (and whose best match overall is a squirrel)
 * is then not named from the bird list; a beetle whose best match overall was a woodpecker is not named at all.
 */
export function gateAgreesWithSpecies(groups: readonly SpeciesLabel['group'][] | null, bestOverall: SpeciesLabel | undefined): boolean {
  return !groups || !bestOverall || groups.includes(bestOverall.group);
}

/**
 * When no single species is certain enough, the family may be: if the names that share one family together hold at
 * least the automatic-tag share, the family's name is offered instead ("Owls" rather than a confident wrong owl).
 * A family with one member in the list is never offered (that would be the species in disguise), and nothing is
 * offered when no family stands out, so unknown stays unknown. Always uses the unpersonalised ranking.
 */
export function familyFallback(ranked: readonly Suggestion[]): { family: string; probability: number } | undefined {
  const shares = new Map<string, { probability: number; members: number }>();
  for (const entry of ranked) {
    const family = entry.label.family?.trim();
    if (!family) continue;
    const share = shares.get(family) ?? { probability: 0, members: 0 };
    share.probability += entry.probability;
    share.members += 1;
    shares.set(family, share);
  }
  let best: { family: string; probability: number } | undefined;
  for (const [family, share] of shares) {
    if (share.members < 2 || !shouldAutoTag(Math.min(1, share.probability), FAMILY_MINIMUM)) continue;
    if (!best || share.probability > best.probability) best = { family, probability: Math.min(1, share.probability) };
  }
  return best;
}

/** Personal preferences can reorder suggestions, but cannot qualify a name for automatic tagging. */
export function qualifiesForAutoTag(
  suggested: Suggestion, embedding: Float32Array, labels: readonly SpeciesLabel[], vectors: readonly Float32Array[],
): boolean {
  // A softmax over one available label is 100% by definition, even for an
  // unrelated animal. It may be shown for manual consideration, never applied.
  const minimum = autoTagMinimum(suggested.label.group);
  if (labels.length < 2 || labels.length !== vectors.length || !shouldAutoTag(suggested.probability, minimum)) return false;
  const strongest = rankSpecies(embedding, labels, vectors)[0];
  return strongest?.index === suggested.index && shouldAutoTag(strongest.probability, minimum);
}

/** Photos the species model has not looked at yet: still in the library, never checked, and with nothing of the user's own on them. */
export function scanCandidates<T extends { id: string; removedAt?: number; speciesChecked?: boolean; tags?: readonly string[]; subjectNames?: readonly string[]; subjectKind?: string }>(
  frames: readonly T[],
  { includeUnclassified = false }: { includeUnclassified?: boolean } = {},
): T[] {
  // The local species model has a *closed* list of animal labels: its softmax can be extremely sure a helicopter is an
  // osprey because "helicopter" is not an option. So it only ever looks at photos positively classified as wildlife, and
  // never infers "wildlife" from its own guess. The opted-in online helper is open-world (it answers "not an animal"
  // and sets the kind itself), so it may also look at photos nobody has classified yet. Photos classified as people,
  // landscape or other are never scanned.
  return frames.filter((frame) => frame.removedAt == null && !frame.speciesChecked &&
    (frame.subjectKind === 'wildlife' || (includeUnclassified && !frame.subjectKind)) &&
    !(frame.tags?.length) && !(frame.subjectNames?.length));
}

/**
 * What to store after a photo has been looked at. It is always marked as checked. A name is added only when the model was
 * sure, the photo may take it, and it is on the species list the model knows.
 */
export function scanPatch(
  frame: { tags?: readonly string[]; subjectNames?: readonly string[]; subjectKind?: string; removedAt?: number } & AutoState,
  best: { name: string; probability: number; kind?: SubjectKind } | undefined,
): { speciesChecked: true; tags?: string[]; autoTags?: string[]; subjectKind?: SubjectKind } {
  // A scan can finish after the photo has been removed. Never resurrect a removed photo with a species tag.
  if (frame.removedAt != null || frame.subjectKind !== 'wildlife' || best?.kind !== 'wildlife' ||
      !shouldAutoTag(best.probability) || !mayAutoTag(frame, best.name)) return { speciesChecked: true };
  return { speciesChecked: true, ...applyAutoTag(frame, best.name), ...(frame.subjectKind || !best.kind ? {} : { subjectKind: best.kind }) };
}

/** The species to show on a photo's card: an automatic tag the user has not kept yet, or the first tag of a wildlife photo. */
export function speciesShown(frame: { autoTags?: readonly string[]; tags?: readonly string[]; subjectKind?: string; subjectDisputed?: boolean }): { name: string; auto: boolean } | null {
  // Older catalogues may contain mistaken automatic bird names on an aircraft.
  // Never display those names as a species once a photo is known to be non-wildlife.
  if (frame.subjectKind !== 'wildlife') return null;
  // A disputed subject hides names the app added by itself, and only those: a name the person kept is theirs.
  if (frame.subjectDisputed) {
    const own = frame.tags?.find((tag) => !has(frame.autoTags, tag));
    return own ? { name: own, auto: false } : null;
  }
  if (frame.autoTags?.length) return { name: frame.autoTags[0], auto: true };
  if (frame.tags?.length) return { name: frame.tags[0], auto: false };
  return null;
}

/**
 * What a Photo Check outcome does to the photo's dispute flag. A disagreement sets it; an agreement clears it; an
 * unverified check (one witness, or none) changes nothing, so it can neither raise nor settle a dispute.
 * Null means no change is needed.
 */
export function disputePatch(frame: { subjectDisputed?: boolean }, outcome: 'agreed' | 'conflict' | 'unverified'): { subjectDisputed: boolean } | null {
  const now = frame.subjectDisputed === true;
  if (outcome === 'conflict') return now ? null : { subjectDisputed: true };
  if (outcome === 'agreed') return now ? { subjectDisputed: false } : null;
  return null;
}

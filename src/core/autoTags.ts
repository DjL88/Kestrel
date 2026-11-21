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
export const shouldAutoTag = (probability: number) => probability >= AUTO_MINIMUM && probability <= 1;

/** Personal preferences can reorder suggestions, but cannot qualify a name for automatic tagging. */
export function qualifiesForAutoTag(
  suggested: Suggestion, embedding: Float32Array, labels: readonly SpeciesLabel[], vectors: readonly Float32Array[],
): boolean {
  // A softmax over one available label is 100% by definition, even for an
  // unrelated animal. It may be shown for manual consideration, never applied.
  if (labels.length < 2 || labels.length !== vectors.length || !shouldAutoTag(suggested.probability)) return false;
  const strongest = rankSpecies(embedding, labels, vectors)[0];
  return strongest?.index === suggested.index && shouldAutoTag(strongest.probability);
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

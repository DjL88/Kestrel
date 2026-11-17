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
export function mayAutoTag(photo: { tags?: readonly string[]; subjectNames?: readonly string[] } & AutoState, name: string): boolean {
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
  if (!shouldAutoTag(suggested.probability)) return false;
  const strongest = rankSpecies(embedding, labels, vectors)[0];
  return strongest?.index === suggested.index && shouldAutoTag(strongest.probability);
}

/** Photos the species model has not looked at yet: still in the library, never checked, and with nothing of the user's own on them. */
export function scanCandidates<T extends { id: string; removedAt?: number; speciesChecked?: boolean; tags?: readonly string[]; subjectNames?: readonly string[]; subjectKind?: string }>(frames: readonly T[]): T[] {
  // Species models have a *closed* list of animal labels. Their softmax may be
  // extremely sure a helicopter is an osprey because "helicopter" is not an
  // option. Only scan photographs positively classified as wildlife, never
  // infer "wildlife" from the species model's own guess.
  return frames.filter((frame) => !frame.removedAt && !frame.speciesChecked &&
    frame.subjectKind === 'wildlife' && !(frame.tags?.length) && !(frame.subjectNames?.length));
}

/**
 * What to store after a photo has been looked at. It is always marked as checked. A name is added only when the model was
 * sure, the photo may take it, and it is on the species list the model knows.
 */
export function scanPatch(
  frame: { tags?: readonly string[]; subjectNames?: readonly string[]; subjectKind?: string } & AutoState,
  best: { name: string; probability: number; kind?: SubjectKind } | undefined,
): { speciesChecked: true; tags?: string[]; autoTags?: string[]; subjectKind?: SubjectKind } {
  if (frame.subjectKind !== 'wildlife' || best?.kind !== 'wildlife' ||
      !shouldAutoTag(best.probability) || !mayAutoTag(frame, best.name)) return { speciesChecked: true };
  return { speciesChecked: true, ...applyAutoTag(frame, best.name), ...(frame.subjectKind || !best.kind ? {} : { subjectKind: best.kind }) };
}

/** The species to show on a photo's card: an automatic tag the user has not kept yet, or the first tag of a wildlife photo. */
export function speciesShown(frame: { autoTags?: readonly string[]; tags?: readonly string[]; subjectKind?: string }): { name: string; auto: boolean } | null {
  if (frame.autoTags?.length) return { name: frame.autoTags[0], auto: true };
  if (frame.subjectKind === 'wildlife' && frame.tags?.length) return { name: frame.tags[0], auto: false };
  return null;
}

/** What a photo is mainly of. Chosen by the user, and what any later suggestions are tuned to. */
export type SubjectKind = 'wildlife' | 'people' | 'landscape' | 'other';

export const SUBJECT_KINDS: readonly { id: SubjectKind; label: string; hint: string }[] = [
  { id: 'wildlife', label: 'Wildlife', hint: 'Animals, birds, insects' },
  { id: 'people', label: 'People', hint: 'Portraits, groups, events' },
  { id: 'landscape', label: 'Landscape', hint: 'Places, scenery, sky' },
  { id: 'other', label: 'Other', hint: 'Anything else' },
];

export const MAX_TAGS = 24;
export const MAX_TAG_LENGTH = 40;

/** Quick-add words for each kind. They are shortcuts for typing, not guesses about the photo. */
export const STARTER_TAGS: Record<SubjectKind, readonly string[]> = {
  wildlife: ['Bird', 'Bird of prey', 'Mammal', 'Insect', 'In flight', 'Perched', 'Feeding', 'Young'],
  people: ['Portrait', 'Group', 'Candid', 'Event', 'Family', 'Child'],
  landscape: ['Sunrise', 'Sunset', 'Coast', 'Mountain', 'Woodland', 'Moorland', 'River', 'Mist', 'Night sky'],
  other: ['Street', 'Architecture', 'Macro', 'Still life', 'Abstract', 'Pet'],
};

/** One tag, tidied: control characters gone, spaces collapsed, and a sensible length. */
export function cleanTag(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH).trim();
}

/** Split typed text on commas and new lines. */
export function parseTagInput(text: string): string[] {
  return text.split(/[,\n]/).map(cleanTag).filter(Boolean);
}

/** Add tags without repeats (ignoring capital letters), keeping the first spelling, up to the limit. */
export function addTags(current: readonly string[], incoming: readonly string[]): string[] {
  const seen = new Map<string, string>();
  for (const tag of [...current, ...incoming]) {
    const clean = cleanTag(tag);
    if (clean && !seen.has(clean.toLowerCase()) && seen.size < MAX_TAGS) seen.set(clean.toLowerCase(), clean);
  }
  return [...seen.values()];
}

export function removeTag(current: readonly string[], tag: string): string[] {
  return current.filter((entry) => entry.toLowerCase() !== tag.toLowerCase());
}

/** The words a photo can be found by: its kind, then its tags and any older subject names. */
export function searchWords(photo: { subjectKind?: SubjectKind; tags?: readonly string[]; subjectNames?: readonly string[] }): string[] {
  const kind = SUBJECT_KINDS.find((entry) => entry.id === photo.subjectKind)?.label;
  return [...(kind ? [kind] : []), ...addTags(photo.subjectNames ?? [], photo.tags ?? [])];
}

export const isSubjectKind = (value: unknown): value is SubjectKind => SUBJECT_KINDS.some((entry) => entry.id === value);

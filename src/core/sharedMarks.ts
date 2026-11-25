/**
 * Ratings and flags in shared projects (#1387 C03, #1152). A shared revision carries the photo's edit and, beside it,
 * its marks: the star rating and the pick/set-aside decision. Pure.
 *
 * When two people changed the same photo, changes to different things are combined (you rated it, they edited it: both
 * stay). Only when both changed the same thing to different values does the person choose. Nothing is ever dropped
 * silently, and a revision from an older app with no marks never clears anyone's rating.
 */
import type { CullDecision } from './types';
import { recipeFingerprint } from './sharedSync';

export interface SharedMarks {
  /** 0 to 5 stars; 0 is unrated. */
  rating: number;
  decision: CullDecision;
}

export const DEFAULT_MARKS: SharedMarks = { rating: 0, decision: 'unreviewed' };

const DECISIONS: readonly CullDecision[] = ['unreviewed', 'keep', 'reject'];

/** Marks as they arrive from another member; undefined when absent or unreadable (then nothing is applied). */
export function readSharedMarks(value: unknown): SharedMarks | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.rating !== 'number' || !Number.isInteger(v.rating) || v.rating < 0 || v.rating > 5) return undefined;
  if (typeof v.decision !== 'string' || !DECISIONS.includes(v.decision as CullDecision)) return undefined;
  return { rating: v.rating, decision: v.decision as CullDecision };
}

/** A photo's marks from its stored fields, bounded the same way. */
export function marksOf(frame: { rating?: number; decision?: CullDecision }): SharedMarks {
  const rating = typeof frame.rating === 'number' && Number.isFinite(frame.rating) ? Math.max(0, Math.min(5, Math.round(frame.rating))) : 0;
  return { rating, decision: frame.decision && DECISIONS.includes(frame.decision) ? frame.decision : 'unreviewed' };
}

export function sameMarks(a: SharedMarks, b: SharedMarks): boolean {
  return a.rating === b.rating && a.decision === b.decision;
}

export function isDefaultMarks(marks: SharedMarks | undefined): boolean {
  return !marks || sameMarks(marks, DEFAULT_MARKS);
}

/**
 * The fingerprint a device keeps for "what I last shared". With default marks it is the edit's own fingerprint, so a
 * photo shared before marks were shared still matches and is not sent again.
 */
export function sharedPayloadHash(edit: unknown, marks: SharedMarks | undefined): string {
  return isDefaultMarks(marks) ? recipeFingerprint(edit ?? null) : recipeFingerprint({ edit: edit ?? null, marks });
}

export type SharedField = 'edit' | 'rating' | 'decision';

export interface SharedSide { edit: Record<string, unknown> | null; marks: SharedMarks }

export type MergeResult =
  /** Combined without a clash. `edit` and `marks` are what both devices should now hold; `takesTheirEdit` says the edit comes from the other side. */
  | { kind: 'merged'; edit: Record<string, unknown> | null; marks: SharedMarks; takesTheirEdit: boolean }
  /** Both changed the same thing differently: the person chooses. */
  | { kind: 'conflict'; fields: SharedField[] };

/**
 * Three-way merge of one photo. `base` is what this device last matched on the shared copy (its edit fingerprint and
 * marks); without it nothing can be combined safely and every difference is a clash. `theirMarks` undefined means the
 * other revision came from an app that does not share marks: their marks count as unchanged.
 */
export function mergeShared(base: { editHash: string; marks: SharedMarks } | null, mine: SharedSide, theirs: { edit: Record<string, unknown> | null; marks: SharedMarks | undefined }): MergeResult {
  const mineEdit = recipeFingerprint(mine.edit ?? null);
  const theirEdit = recipeFingerprint(theirs.edit ?? null);
  // An older app never changes marks, so a revision without them leaves this device's marks as they are.
  const theirMarks = theirs.marks;
  const fields: SharedField[] = [];

  let edit = mine.edit, takesTheirEdit = false;
  if (mineEdit !== theirEdit) {
    if (base && mineEdit === base.editHash) { edit = theirs.edit; takesTheirEdit = true; }
    else if (!(base && theirEdit === base.editHash)) fields.push('edit');
  }

  const pick = <K extends keyof SharedMarks>(key: K): SharedMarks[K] => {
    const m = mine.marks[key];
    if (!theirMarks) return m;
    const t = theirMarks[key];
    if (m === t) return m;
    if (base && m === base.marks[key]) return t;
    if (base && t === base.marks[key]) return m;
    fields.push(key as SharedField);
    return m;
  };
  const marks: SharedMarks = { rating: pick('rating'), decision: pick('decision') };
  return fields.length ? { kind: 'conflict', fields } : { kind: 'merged', edit, marks, takesTheirEdit };
}

/** One photo as this device shares it. `marks` is absent when the app does not share marks (then only the edit goes). */
export interface SharedPayload { edit: Record<string, unknown> | null; marks?: SharedMarks }

/** The recipe a shared revision stores: the edit, and the marks beside it. */
export function sharedRecipe(payload: SharedPayload): Record<string, unknown> {
  return payload.marks ? { edit: payload.edit, marks: payload.marks } : { edit: payload.edit };
}

/** The other side of a revision as it arrived; its marks are undefined when it carried none (or they were unreadable). */
export function readRecipeSide(recipe: Record<string, unknown> | null | undefined): { edit: Record<string, unknown> | null; marks: SharedMarks | undefined } {
  const edit = recipe?.edit;
  return { edit: edit && typeof edit === 'object' && !Array.isArray(edit) ? edit as Record<string, unknown> : null, marks: readSharedMarks(recipe?.marks) };
}

/** What this device records after it matched a revision: enough to combine later changes to different things. */
export function syncPointFor(revisionId: string | null, payload: SharedPayload): import('./sharedSync').SyncPoint {
  return { revisionId, recipeHash: sharedPayloadHash(payload.edit, payload.marks), editHash: recipeFingerprint(payload.edit ?? null), ...(payload.marks ? { marks: payload.marks } : {}) };
}

/** A photo with neither an edit nor any marks: it simply takes the shared copy. */
export function isUntouched(payload: SharedPayload): boolean {
  return payload.edit === null && isDefaultMarks(payload.marks);
}

/**
 * Combines this device's photo with a newer shared revision when the two changed different things. Needs the record
 * of what this device last matched (with its edit fingerprint and marks); otherwise it is always a clash.
 */
export function combineWithShared(point: import('./sharedSync').SyncPoint | null, mine: SharedPayload, theirRecipe: Record<string, unknown> | null | undefined): MergeResult {
  const base = point?.editHash ? { editHash: point.editHash, marks: readSharedMarks(point.marks) ?? DEFAULT_MARKS } : null;
  const result = mergeShared(base, { edit: mine.edit, marks: mine.marks ?? DEFAULT_MARKS }, readRecipeSide(theirRecipe));
  // An app that does not share marks merges the edit only.
  if (!mine.marks && result.kind === 'conflict') {
    const fields = result.fields.filter((field) => field === 'edit');
    return fields.length ? { kind: 'conflict', fields } : mergeShared(base, { edit: mine.edit, marks: DEFAULT_MARKS }, { edit: readRecipeSide(theirRecipe).edit, marks: undefined });
  }
  return result;
}

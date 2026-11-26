/**
 * Saved views: a named set of the filmstrip's and grid's filters (decision, words, minimum rating, tag and order) that
 * can be put back with one choice. Pure and offline: the list lives on this device only, nothing is uploaded, and
 * applying a view only changes what is shown. No photo, rating or decision is ever changed by it.
 */

export const VIEW_FILTERS = ['all', 'to-review', 'flagged', 'set-aside'] as const;
export const VIEW_SORTS = ['shoot', 'captured-oldest', 'captured-newest', 'filename', 'rating', 'best'] as const;

export type ViewFilter = (typeof VIEW_FILTERS)[number];
export type ViewSort = (typeof VIEW_SORTS)[number];

/** What a view shows. Exactly the filmstrip's own filter fields, so applying one is the same as choosing each by hand. */
export interface ViewCriteria {
  filter: ViewFilter;
  search: string;
  minRating: number;
  sort: ViewSort;
  tag: string | null;
}

export interface SavedView {
  id: string;
  name: string;
  criteria: ViewCriteria;
}

export const SAVED_VIEWS_KEY = 'kestrel.saved-views.v1';
export const MAX_SAVED_VIEWS = 30;
export const MAX_VIEW_NAME = 60;
const MAX_SEARCH = 200;
const MAX_TAG = 200;

export const DEFAULT_CRITERIA: ViewCriteria = { filter: 'all', search: '', minRating: 0, sort: 'shoot', tag: null };

/** A view's name as it is stored: spaces tidied, control characters removed, at most MAX_VIEW_NAME characters. */
export function cleanViewName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_VIEW_NAME).trim();
}

/** Criteria read from anything (an old or hand-edited store), or null when any field is not one the filmstrip knows. */
export function readCriteria(raw: unknown): ViewCriteria | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.filter !== 'string' || !(VIEW_FILTERS as readonly string[]).includes(value.filter)) return null;
  if (typeof value.sort !== 'string' || !(VIEW_SORTS as readonly string[]).includes(value.sort)) return null;
  if (typeof value.search !== 'string' || value.search.length > MAX_SEARCH) return null;
  if (typeof value.minRating !== 'number' || !Number.isInteger(value.minRating) || value.minRating < 0 || value.minRating > 5) return null;
  if (value.tag !== null && (typeof value.tag !== 'string' || value.tag.length === 0 || value.tag.length > MAX_TAG)) return null;
  return { filter: value.filter as ViewFilter, search: value.search, minRating: value.minRating, sort: value.sort as ViewSort, tag: value.tag as string | null };
}

/** The saved list read from storage text. Entries that are damaged are left out one by one; the rest are kept. */
export function parseSavedViews(text: string | null | undefined): SavedView[] {
  if (!text) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const views: SavedView[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, name, criteria } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || !id || id.length > 80 || seen.has(id)) continue;
    if (typeof name !== 'string') continue;
    const clean = cleanViewName(name);
    const read = readCriteria(criteria);
    if (!clean || !read) continue;
    seen.add(id);
    views.push({ id, name: clean, criteria: read });
    if (views.length >= MAX_SAVED_VIEWS) break;
  }
  return views;
}

export function serialiseSavedViews(views: readonly SavedView[]): string {
  return JSON.stringify(views.slice(0, MAX_SAVED_VIEWS));
}

export type SaveViewResult =
  | { ok: true; views: SavedView[]; view: SavedView; replaced: boolean }
  | { ok: false; reason: 'empty-name' | 'full' | 'invalid' };

/**
 * Saves the criteria under a name. A view with the same name (ignoring case) is replaced in place, so saving
 * "Birds to finish" twice keeps one entry; otherwise the new view goes at the end. Never more than MAX_SAVED_VIEWS.
 */
export function saveView(views: readonly SavedView[], name: string, criteria: ViewCriteria, makeId: () => string): SaveViewResult {
  const clean = cleanViewName(name);
  if (!clean) return { ok: false, reason: 'empty-name' };
  const read = readCriteria(criteria);
  if (!read) return { ok: false, reason: 'invalid' };
  const index = views.findIndex((view) => view.name.toLocaleLowerCase() === clean.toLocaleLowerCase());
  if (index >= 0) {
    const view: SavedView = { id: views[index].id, name: clean, criteria: read };
    const next = views.slice();
    next[index] = view;
    return { ok: true, views: next, view, replaced: true };
  }
  if (views.length >= MAX_SAVED_VIEWS) return { ok: false, reason: 'full' };
  const view: SavedView = { id: makeId(), name: clean, criteria: read };
  return { ok: true, views: [...views, view], view, replaced: false };
}

export function deleteView(views: readonly SavedView[], id: string): SavedView[] {
  return views.filter((view) => view.id !== id);
}

export function sameCriteria(a: ViewCriteria, b: ViewCriteria): boolean {
  return a.filter === b.filter && a.search === b.search && a.minRating === b.minRating && a.sort === b.sort && a.tag === b.tag;
}

/** The saved view that matches what is shown right now, if any, so the control can name it. */
export function matchingView(views: readonly SavedView[], current: ViewCriteria): SavedView | null {
  return views.find((view) => sameCriteria(view.criteria, current)) ?? null;
}

export function loadSavedViews(storage: Pick<Storage, 'getItem'> | null | undefined): SavedView[] {
  try { return parseSavedViews(storage?.getItem(SAVED_VIEWS_KEY)); } catch { return []; }
}

/** Writes the list. False when this device would not store it (private browsing, storage full): the caller says so. */
export function storeSavedViews(storage: Pick<Storage, 'setItem'> | null | undefined, views: readonly SavedView[]): boolean {
  if (!storage) return false;
  try { storage.setItem(SAVED_VIEWS_KEY, serialiseSavedViews(views)); return true; } catch { return false; }
}

/**
 * The photo to move to for "next (or previous) photo to review": the nearest photo after (or before) the current one,
 * in the order shown, that has no decision yet. Null when there is none in that direction; it never wraps round, so
 * reaching the end is something the person is told rather than a silent jump back to the start.
 */
export function nextToReview<T extends { id: string; decision: string }>(shown: readonly T[], currentId: string | null | undefined, delta: 1 | -1): T | null {
  const start = shown.findIndex((photo) => photo.id === currentId);
  for (let i = start < 0 ? (delta === 1 ? 0 : shown.length - 1) : start + delta; i >= 0 && i < shown.length; i += delta) {
    if (shown[i].decision === 'unreviewed') return shown[i];
  }
  return null;
}

/**
 * Safe sync of one photo's edit in a shared project (#1387 C02/C03). Pure: the app keeps, per device, the last shared
 * revision it matched and a fingerprint of the recipe at that moment. Comparing that with the photo's recipe now and
 * the shared head says what to do. Nothing is ever overwritten without the person choosing: when both sides changed,
 * the answer is a conflict, and the person keeps theirs, keeps mine, or keeps both.
 */
export interface SyncPoint { revisionId: string | null; recipeHash: string }

export type SyncPlan =
  | { action: 'in-sync' }
  /** Only the shared copy moved: take it. */
  | { action: 'pull'; headId: string }
  /** Only this device moved: share it (needs the checkout). */
  | { action: 'push'; baseRevisionId: string | null }
  /** Both moved since this device last matched: the person chooses. */
  | { action: 'conflict'; headId: string };

import type { PhotoEdit } from './photoEdits';

/** The most a shared edit may be: the control plane refuses larger recipes too. */
export const MAX_SHARED_EDIT_CHARS = 256 * 1024;

/**
 * A shared edit as it arrives from another member: plain JSON data only, bounded in size, with no non-finite numbers.
 * null means "no edit". false means it could not be read and must not be applied.
 */
export function readSharedEdit(value: unknown): PhotoEdit | null | false {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const finite = (item: unknown, depth: number): boolean => depth > 32 ? false : typeof item === 'number' ? Number.isFinite(item)
    : Array.isArray(item) ? item.every((entry) => finite(entry, depth + 1)) : item && typeof item === 'object' ? Object.values(item).every((entry) => finite(entry, depth + 1)) : true;
  let text: string;
  try { if (!finite(value, 0)) return false; text = JSON.stringify(value); } catch { return false; }
  if (text.length > MAX_SHARED_EDIT_CHARS) return false;
  const copy = JSON.parse(text) as Record<string, unknown>;
  return typeof copy.exposure === 'string' ? false : copy as unknown as PhotoEdit;
}

/** The photo's identity across devices: the original's full-content fingerprint, so the same file matches anywhere. */
export function sharedPhotoKey(originalSha256: string | undefined, virtualCopyNumber?: number): string | undefined {
  if (!originalSha256 || !/^[0-9a-f]{64}$/i.test(originalSha256)) return undefined;
  const sha = originalSha256.toLowerCase();
  return virtualCopyNumber ? `v${virtualCopyNumber}_${sha}` : `o_${sha}`;
}

/** A stable fingerprint of a recipe: key order does not matter. Not a security hash; it only spots change. */
export function recipeFingerprint(recipe: unknown): string {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value as object).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])]));
    return value;
  };
  const text = JSON.stringify(stable(recipe)) ?? '';
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x5bd1e995) >>> 0;
  }
  return `${text.length.toString(36)}-${h1.toString(36)}-${h2.toString(36)}`;
}

/**
 * `last` is null when this device has never synced this photo. Then a photo with no shared history is shared as it is,
 * an unedited photo takes the shared edit, and an edited photo that meets a different shared edit is a conflict.
 */
export function planSync(last: SyncPoint | null, localHash: string, headId: string | null, unedited: boolean): SyncPlan {
  if (!last) {
    if (headId === null) return unedited ? { action: 'in-sync' } : { action: 'push', baseRevisionId: null };
    return unedited ? { action: 'pull', headId } : { action: 'conflict', headId };
  }
  const localMoved = localHash !== last.recipeHash;
  const sharedMoved = headId !== last.revisionId;
  if (!sharedMoved) return localMoved ? { action: 'push', baseRevisionId: headId } : { action: 'in-sync' };
  if (headId === null) return { action: 'push', baseRevisionId: null };
  return localMoved ? { action: 'conflict', headId } : { action: 'pull', headId };
}

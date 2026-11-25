/**
 * C03 — revision history and offline conflict recovery (#1387). Shared edits are never last-write-wins: every shared
 * revision names its parent, and a save is accepted only from the current lease holder starting from the current head.
 * An edit made offline is a draft until it is reconciled; when someone else changed the photo meanwhile, both versions
 * are kept and the person chooses. Nothing here discards a decision. Generic over the recipe so it stays pure.
 */
import { leaseStatus, DEFAULT_LEASE_SETTINGS, type LeaseSettings, type PhotoLease } from './photoLease';

export interface SharedRevision<R> {
  id: string;
  /** 1, 2, 3… per photo, for people to refer to. */
  number: number;
  parentId: string | null;
  authorAccountId: string;
  createdAtMs: number;
  recipe: R;
  /** Set when this revision is a published virtual copy rather than the photo's main line. */
  virtualCopyOf?: string;
}

export interface RevisionHistory<R> {
  photoId: string;
  revisions: readonly SharedRevision<R>[];
}

export function headOf<R>(history: RevisionHistory<R>): SharedRevision<R> | undefined {
  for (let i = history.revisions.length - 1; i >= 0; i--) if (!history.revisions[i].virtualCopyOf) return history.revisions[i];
  return undefined;
}

export interface PublishRequest<R> {
  id: string;
  authorAccountId: string;
  token: string;
  baseRevisionId: string | null;
  recipe: R;
  atMs: number;
}

export type PublishResult<R> =
  | { ok: true; history: RevisionHistory<R>; revision: SharedRevision<R> }
  | { ok: false; reason: 'no-lease' | 'lease-lapsed' | 'stale-base'; head?: SharedRevision<R> };

/** Server-side rule for a shared save: the author holds a live lease with this token, and starts from the head. */
export function publishRevision<R>(history: RevisionHistory<R>, lease: PhotoLease | undefined, request: PublishRequest<R>, settings: LeaseSettings = DEFAULT_LEASE_SETTINGS): PublishResult<R> {
  const head = headOf(history);
  if (!lease || lease.photoId !== history.photoId || lease.token !== request.token || lease.holderAccountId !== request.authorAccountId) return { ok: false, reason: 'no-lease', head };
  if (leaseStatus(lease, request.atMs, settings).state === 'expired') return { ok: false, reason: 'lease-lapsed', head };
  if ((head?.id ?? null) !== request.baseRevisionId) return { ok: false, reason: 'stale-base', head };
  const revision: SharedRevision<R> = {
    id: request.id, number: history.revisions.length + 1, parentId: request.baseRevisionId,
    authorAccountId: request.authorAccountId, createdAtMs: request.atMs, recipe: request.recipe,
  };
  return { ok: true, history: { ...history, revisions: [...history.revisions, revision] }, revision };
}

/** An edit saved while offline or after the lease lapsed. It lives on the device until reconciled. */
export interface OfflineDraft<R> {
  photoId: string;
  authorAccountId: string;
  baseRevisionId: string | null;
  recipe: R;
  savedAtMs: number;
}

export type ConflictChoice = 'keep-mine' | 'keep-theirs' | 'virtual-copy';

export type Reconciliation<R> =
  /** Nobody else changed the photo: reacquire the lease and publish the draft on top of its base. */
  | { kind: 'fast-forward'; baseRevisionId: string | null }
  /** The head already holds exactly this recipe: nothing to publish. */
  | { kind: 'already-shared'; head: SharedRevision<R> }
  /** Someone else published since: show both and let the person choose. */
  | { kind: 'conflict'; mine: OfflineDraft<R>; theirs: readonly SharedRevision<R>[]; head: SharedRevision<R>; choices: readonly ConflictChoice[] };

export function reconcileOfflineDraft<R>(history: RevisionHistory<R>, draft: OfflineDraft<R>, same: (a: R, b: R) => boolean): Reconciliation<R> {
  const head = headOf(history);
  if (head && same(head.recipe, draft.recipe)) return { kind: 'already-shared', head };
  if ((head?.id ?? null) === draft.baseRevisionId) return { kind: 'fast-forward', baseRevisionId: draft.baseRevisionId };
  const start = draft.baseRevisionId === null ? -1 : history.revisions.findIndex((revision) => revision.id === draft.baseRevisionId);
  const theirs = history.revisions.slice(start + 1).filter((revision) => !revision.virtualCopyOf);
  return { kind: 'conflict', mine: draft, theirs, head: head!, choices: ['keep-mine', 'keep-theirs', 'virtual-copy'] };
}

export type ConflictOutcome<R> =
  /** Publish the draft as the next revision on the current head (needs the lease, like any save). */
  | { action: 'publish'; baseRevisionId: string; recipe: R }
  /** Publish the draft beside the head as a virtual copy; the main line is untouched. */
  | { action: 'publish-virtual-copy'; baseRevisionId: string; recipe: R; virtualCopyOf: string }
  /** Use the shared head. The draft is kept on the device as a local virtual copy, never deleted silently. */
  | { action: 'keep-shared'; retainedDraft: OfflineDraft<R> };

export function resolveConflict<R>(conflict: Extract<Reconciliation<R>, { kind: 'conflict' }>, choice: ConflictChoice): ConflictOutcome<R> {
  const { head, mine } = conflict;
  if (choice === 'keep-mine') return { action: 'publish', baseRevisionId: head.id, recipe: mine.recipe };
  if (choice === 'virtual-copy') return { action: 'publish-virtual-copy', baseRevisionId: head.id, recipe: mine.recipe, virtualCopyOf: head.id };
  return { action: 'keep-shared', retainedDraft: mine };
}

/** Records a published virtual copy. Same lease rule as a normal save, but it never moves the head. */
export function publishVirtualCopy<R>(history: RevisionHistory<R>, lease: PhotoLease | undefined, request: PublishRequest<R> & { virtualCopyOf: string }, settings: LeaseSettings = DEFAULT_LEASE_SETTINGS): PublishResult<R> {
  if (!history.revisions.some((revision) => revision.id === request.virtualCopyOf)) return { ok: false, reason: 'stale-base', head: headOf(history) };
  const result = publishRevision(history, lease, { ...request, baseRevisionId: headOf(history)?.id ?? null }, settings);
  if (!result.ok) return result;
  const revision = { ...result.revision, parentId: request.virtualCopyOf, virtualCopyOf: request.virtualCopyOf };
  return { ok: true, history: { ...history, revisions: [...history.revisions, revision] }, revision };
}

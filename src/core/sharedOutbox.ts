/**
 * Offline outbox for shared projects (#1387 C03, #1152). Every photo whose edit changed on this device and has not yet
 * been shared is listed here, on the device, until the shared project accepts it. It survives a restart, so an edit made
 * offline (or just before the app closed) is shared when the device is back online, even if the photo is never opened
 * again. Pure: the app reads and writes the list; this module says what each entry should do next.
 *
 * Nothing here overwrites anyone. A photo whose shared copy moved on since this device last matched it becomes a
 * conflict and waits for the person to choose, exactly as when the photo is open. Entries belong to the account that
 * made the edit, so a different account signed in on the same device never shares them.
 */
import { planSync, type SyncPoint } from './sharedSync';

export interface OutboxEntry {
  /** The shared project's id on the control plane. */
  project: string;
  /** The photo's shared key (see sharedPhotoKey). */
  key: string;
  /** The photo's id in this device's catalogue. */
  photoId: string;
  /** The account that made the edit; null if it was not known yet. */
  accountId: string | null;
  queuedAtMs: number;
  attempts: number;
  nextTryMs: number;
  state: 'pending' | 'conflict';
  /** For a conflict: the shared revision that moved on. */
  headId?: string;
}

/** A device would only ever hold this many by accident; beyond it the oldest pending entries are kept, not dropped. */
export const MAX_OUTBOX_ENTRIES = 5_000;
const FIRST_RETRY_MS = 15_000;
const MAX_RETRY_MS = 15 * 60_000;

const same = (entry: OutboxEntry, project: string, key: string) => entry.project === project && entry.key === key;

/** Reads the stored list, keeping only well-formed entries. Anything unreadable is ignored, never thrown. */
export function readOutbox(value: unknown): OutboxEntry[] {
  if (!Array.isArray(value)) return [];
  const text = (item: unknown, max = 512): item is string => typeof item === 'string' && item.length > 0 && item.length <= max;
  const count = (item: unknown): item is number => typeof item === 'number' && Number.isFinite(item) && item >= 0;
  const out: OutboxEntry[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    if (!text(e.project) || !text(e.key) || !text(e.photoId) || !count(e.queuedAtMs) || !count(e.attempts) || !count(e.nextTryMs)) continue;
    if (e.state !== 'pending' && e.state !== 'conflict') continue;
    if (out.some((entry) => same(entry, e.project as string, e.key as string))) continue;
    out.push({
      project: e.project, key: e.key, photoId: e.photoId, accountId: text(e.accountId) ? e.accountId : null,
      queuedAtMs: e.queuedAtMs, attempts: Math.floor(e.attempts), nextTryMs: e.nextTryMs, state: e.state,
      ...(e.state === 'conflict' && text(e.headId) ? { headId: e.headId } : {}),
    });
    if (out.length >= MAX_OUTBOX_ENTRIES) break;
  }
  return out;
}

/**
 * Lists a photo as having an edit to share. A photo already listed keeps its place in the queue; a conflict stays a
 * conflict (a further edit does not make the other person's change go away).
 */
export function queueEdit(entries: readonly OutboxEntry[], item: { project: string; key: string; photoId: string; accountId: string | null }, nowMs: number): OutboxEntry[] {
  const found = entries.find((entry) => same(entry, item.project, item.key));
  if (found) {
    return entries.map((entry) => entry === found
      ? { ...entry, photoId: item.photoId, accountId: item.accountId ?? entry.accountId, ...(entry.state === 'pending' ? { attempts: 0, nextTryMs: nowMs } : {}) }
      : entry);
  }
  if (entries.length >= MAX_OUTBOX_ENTRIES) return [...entries];
  return [...entries, { ...item, queuedAtMs: nowMs, attempts: 0, nextTryMs: nowMs, state: 'pending' }];
}

/** The photo's edit is shared (or the person chose what to keep): take it off the list. */
export function settleEdit(entries: readonly OutboxEntry[], project: string, key: string): OutboxEntry[] {
  return entries.filter((entry) => !same(entry, project, key));
}

/** Both sides changed the photo. It waits for the person, and is not retried in the background. */
export function markConflict(entries: readonly OutboxEntry[], project: string, key: string, headId: string): OutboxEntry[] {
  return entries.map((entry) => same(entry, project, key) ? { ...entry, state: 'conflict' as const, headId } : entry);
}

/** How long to wait after a failed attempt: 15 s, 30 s, 1 min… up to 15 min. */
export function retryDelayMs(attempts: number): number {
  return Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** Math.max(0, Math.min(16, attempts - 1)));
}

/** Could not share it this time (offline, or someone else has the photo out): try again later, keep the edit. */
export function markRetry(entries: readonly OutboxEntry[], project: string, key: string, nowMs: number): OutboxEntry[] {
  return entries.map((entry) => {
    if (!same(entry, project, key) || entry.state !== 'pending') return entry;
    const attempts = entry.attempts + 1;
    return { ...entry, attempts, nextTryMs: nowMs + retryDelayMs(attempts) };
  });
}

/**
 * The entries to try now for this project and account, oldest first. `skipKey` is the photo on screen, which shares
 * through its own session. `force` ignores the back-off (the device has just come back online, or the person asked).
 */
export function dueEntries(entries: readonly OutboxEntry[], project: string, accountId: string, nowMs: number, options: { skipKey?: string | null; force?: boolean } = {}): OutboxEntry[] {
  return entries
    .filter((entry) => entry.project === project && entry.state === 'pending' && entry.key !== options.skipKey
      && (entry.accountId === null || entry.accountId === accountId) && (options.force || entry.nextTryMs <= nowMs))
    .sort((a, b) => a.queuedAtMs - b.queuedAtMs);
}

export interface OutboxSummary { waiting: number; conflicts: number; conflictPhotoIds: string[] }

/**
 * What to tell the person about one project: how many edits wait to be shared, and which photos need a choice.
 * `skipKey` is the photo on screen, whose own line already says where its edit stands.
 */
export function outboxSummary(entries: readonly OutboxEntry[], project: string | null, skipKey?: string | null): OutboxSummary {
  const mine = project ? entries.filter((entry) => entry.project === project && entry.key !== skipKey) : [];
  const conflicts = mine.filter((entry) => entry.state === 'conflict');
  return { waiting: mine.length - conflicts.length, conflicts: conflicts.length, conflictPhotoIds: conflicts.map((entry) => entry.photoId) };
}

export type BackgroundStep =
  /** Share this device's edit on top of this revision. */
  | { step: 'publish'; baseRevisionId: string | null }
  /** Nothing of this device's is left to share (already shared, or only the shared copy moved; that is taken on open). */
  | { step: 'settle' }
  /** Both sides changed: wait for the person. */
  | { step: 'conflict'; headId: string };

/**
 * What to do with one queued photo that is not on screen. Uses the same rule as an open photo (planSync), so the
 * background can never do what opening the photo would not.
 */
export function backgroundStep(last: SyncPoint | null, localHash: string, headId: string | null, unedited: boolean): BackgroundStep {
  const plan = planSync(last, localHash, headId, unedited);
  if (plan.action === 'push') return { step: 'publish', baseRevisionId: plan.baseRevisionId };
  if (plan.action === 'conflict') return { step: 'conflict', headId: plan.headId };
  return { step: 'settle' };
}

/** What the background flush needs from the app: the shared project, this device's catalogue and its stored state. */
export interface OutboxFlushDeps {
  acquire(project: string, key: string): Promise<{ token: string }>;
  history(project: string, key: string): Promise<{ headId: string | null }>;
  publish(project: string, key: string, request: { token: string; baseRevisionId: string | null; recipe: Record<string, unknown> }): Promise<{ id: string }>;
  release(project: string, key: string, token: string): Promise<void>;
  /** 'stale' carries the head that moved on; 'checked-out' means someone else has the photo; anything else stops the run. */
  classify(error: unknown): { kind: 'stale'; headId: string } | { kind: 'checked-out' } | { kind: 'other' };
  editOf(photoId: string): Record<string, unknown> | null;
  /** False when the photo was removed from this catalogue: its edit waits, rather than sharing "no edit". */
  exists(photoId: string): boolean;
  pointOf(project: string, key: string): SyncPoint | null;
  setPoint(project: string, key: string, point: SyncPoint): void;
  fingerprint(recipe: unknown): string;
  read(): OutboxEntry[];
  change(update: (entries: OutboxEntry[]) => OutboxEntry[]): void;
  now(): number;
}

/**
 * Shares the queued edits of one project's photos that are not on screen, oldest first, one photo at a time: check it
 * out, compare with the shared head, publish only when nobody else changed it, check it back in. A photo someone else
 * has out is tried again later; any other failure (offline, signed out) stops the run with the queue as it was.
 */
export async function flushOutbox(project: string, accountId: string, deps: OutboxFlushDeps, options: { skipKey?: string | null; force?: boolean } = {}): Promise<{ shared: number; conflicts: number; stopped: boolean }> {
  let shared = 0, conflicts = 0;
  for (const entry of dueEntries(deps.read(), project, accountId, deps.now(), options)) {
    if (!deps.exists(entry.photoId)) { deps.change((entries) => markRetry(entries, project, entry.key, deps.now())); continue; }
    let token: string | null = null;
    try {
      token = (await deps.acquire(project, entry.key)).token;
      const { headId } = await deps.history(project, entry.key);
      const edit = deps.editOf(entry.photoId);
      const step = backgroundStep(deps.pointOf(project, entry.key), deps.fingerprint(edit), headId, edit === null);
      if (step.step === 'conflict') { deps.change((entries) => markConflict(entries, project, entry.key, step.headId)); conflicts += 1; }
      else if (step.step === 'settle') deps.change((entries) => settleEdit(entries, project, entry.key));
      else {
        const revision = await deps.publish(project, entry.key, { token, baseRevisionId: step.baseRevisionId, recipe: { edit } });
        deps.setPoint(project, entry.key, { revisionId: revision.id, recipeHash: deps.fingerprint(edit) });
        deps.change((entries) => settleEdit(entries, project, entry.key));
        shared += 1;
      }
    } catch (error) {
      const kind = deps.classify(error);
      if (kind.kind === 'stale') { deps.change((entries) => markConflict(entries, project, entry.key, kind.headId)); conflicts += 1; }
      else {
        deps.change((entries) => markRetry(entries, project, entry.key, deps.now()));
        if (kind.kind !== 'checked-out') return { shared, conflicts, stopped: true };
      }
    } finally {
      if (token) await deps.release(project, entry.key, token).catch(() => undefined);
    }
  }
  return { shared, conflicts, stopped: false };
}

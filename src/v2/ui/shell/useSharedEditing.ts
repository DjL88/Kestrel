import { useCallback, useEffect, useRef, useState } from 'react';
import { planSync, recipeFingerprint, type SyncPoint } from '../../../core/sharedSync';
import { flushOutbox, markConflict, outboxSummary, queueEdit, readOutbox, settleEdit, type OutboxEntry, type OutboxSummary } from '../../../core/sharedOutbox';
import type { CollabRole } from '../../../core/collabRoles';
import { CollabError, type CollabClient } from '../../../providers/collabClient';
import { readSharedLink } from '../dialogs/sharedLinks';

/**
 * Check-out and safe sync for the photo on screen in a shared project (#1387 C02/C03). Opening a photo checks whether
 * someone else has it out (then it is view-only) and brings in a newer shared edit when this device has not changed it.
 * The first change checks it out; edits are shared a moment after they stop, and it is checked in when you move on.
 * Offline, or when the checkout is lost, the edit stays on this device as a draft and is shared when it can be. When
 * both sides changed, nothing is overwritten: the person keeps theirs or keeps mine.
 *
 * Every photo with an edit not yet shared is also listed in an outbox on this device (core/sharedOutbox). It survives a
 * restart, and photos that are no longer on screen are shared in the background when the device is back online, under
 * the same rule as an open photo: a photo someone else changed meanwhile becomes a conflict that waits for the person.
 */
export type SharedEditingState =
  | { kind: 'off' }
  | { kind: 'no-key' }
  | { kind: 'ready' }
  | { kind: 'mine' }
  | { kind: 'theirs'; holder: string | null }
  /** Viewers, commenters and clients look and comment; only owners and editors change photos. */
  | { kind: 'view-only'; role: Exclude<CollabRole, 'owner' | 'editor'> }
  | { kind: 'draft'; reason: 'offline' | 'lost' }
  | { kind: 'conflict'; headId: string; theirs: Record<string, unknown> | null };

interface EditSource {
  sharedEditOf?: (photoId: string) => Record<string, unknown> | null;
  /** False when the photo is no longer in this catalogue (removed): its queued edit waits rather than sharing "no edit". */
  sharedPhotoExists?: (photoId: string) => boolean;
  applySharedEdit?: (photoId: string, edit: Record<string, unknown> | null) => void;
  keepBothShared?: (photoId: string, theirs: Record<string, unknown> | null) => string | null;
}

const SYNC_KEY = 'inflight.sharedSync.v1';
const OUTBOX_KEY = 'inflight.sharedOutbox.v1';
const OUTBOX_FIRST_TRY_MS = 3_000;
const DEVICE_KEY = 'inflight.deviceId.v1';
const PUBLISH_AFTER_MS = 2_500;
const HEARTBEAT_MS = 30_000;
const RETRY_MS = 60_000;
const PENDING = '__pending__';

function readPoints(): Record<string, SyncPoint> {
  try { const value = JSON.parse(localStorage.getItem(SYNC_KEY) ?? '{}') as unknown; return value && typeof value === 'object' ? value as Record<string, SyncPoint> : {}; } catch { return {}; }
}
function writePoint(key: string, point: SyncPoint) {
  try { const all = readPoints(); all[key] = point; localStorage.setItem(SYNC_KEY, JSON.stringify(all)); } catch { /* private window: sync still works this session */ }
}
function readStoredOutbox(): OutboxEntry[] {
  try { return readOutbox(JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]')); } catch { return []; }
}
function writeStoredOutbox(entries: OutboxEntry[]) {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(entries)); } catch { /* private window: the edit itself is still kept in the catalogue */ }
}
function deviceId(): string {
  try {
    const known = localStorage.getItem(DEVICE_KEY);
    if (known && known.length >= 8) return known;
    const made = `dev-${crypto.randomUUID()}`; localStorage.setItem(DEVICE_KEY, made); return made;
  } catch { return `dev-${crypto.randomUUID()}`; }
}

export function useSharedEditing(client: CollabClient, localProjectId: string | null, photoId: string | null, sharedKey: string | undefined, source: EditSource, changeSignal: unknown, refreshKey: number) {
  const [state, setState] = useState<SharedEditingState>({ kind: 'off' });
  const shared = localProjectId && client.configured && source.sharedEditOf && source.applySharedEdit ? readSharedLink(localProjectId) : null;
  const session = useRef<{ project: string; key: string; photoId: string; token: string | null; opened: boolean; lastChangeMs: number; publishTimer: ReturnType<typeof setTimeout> | null; closed: boolean } | null>(null);
  const stateRef = useRef(state); stateRef.current = state;
  const roles = useRef(new Map<string, CollabRole>());
  const accounts = useRef(new Map<string, string>());
  const [outbox, setOutbox] = useState<OutboxEntry[]>(readStoredOutbox);
  /** Always from storage, so two windows of the app never undo each other's changes to the list. */
  const changeOutbox = useCallback((change: (entries: OutboxEntry[]) => OutboxEntry[]) => {
    const next = change(readStoredOutbox());
    writeStoredOutbox(next);
    setOutbox(next);
  }, []);
  const sourceRef = useRef(source); sourceRef.current = source;
  const pointKey = (project: string, key: string) => `${project}:${key}`;

  const localHash = useCallback((id: string) => recipeFingerprint(sourceRef.current.sharedEditOf?.(id) ?? null), []);

  const failed = useCallback((error: unknown) => {
    if (error instanceof CollabError && error.code === 'COLLAB_PHOTO_CHECKED_OUT') { setState({ kind: 'theirs', holder: typeof error.detail.holder === 'string' ? error.detail.holder : null }); return; }
    if (error instanceof CollabError && error.code === 'COLLAB_LEASE_LOST') { if (session.current) session.current.token = null; setState({ kind: 'draft', reason: 'lost' }); return; }
    setState({ kind: 'draft', reason: 'offline' });
  }, []);

  /** Share this device's edit now. Needs (and takes) the checkout. A stale base becomes a conflict, never an overwrite. */
  const publish = useCallback(async (baseRevisionId?: string | null, flushing?: NonNullable<typeof session.current>) => {
    const s = flushing ?? session.current;
    if (!s || (s.closed && !flushing)) return;
    try {
      if (!s.token) { s.token = (await client.acquire(s.project, s.key, deviceId())).token; }
      const point = readPoints()[pointKey(s.project, s.key)];
      // Never guess the base: with no record of the last match, null makes the server refuse if anyone has saved.
      const base = baseRevisionId !== undefined ? baseRevisionId : point?.revisionId ?? null;
      const edit = sourceRef.current.sharedEditOf?.(s.photoId) ?? null;
      const revision = await client.publish(s.project, s.key, { token: s.token, baseRevisionId: base, recipe: { edit } });
      writePoint(pointKey(s.project, s.key), { revisionId: revision.id, recipeHash: recipeFingerprint(edit) });
      changeOutbox((entries) => settleEdit(entries, s.project, s.key));
      if (!s.closed) setState({ kind: 'mine' });
    } catch (error) {
      if (error instanceof CollabError && error.code === 'COLLAB_STALE_BASE' && typeof error.detail.headId === 'string') {
        const headId = error.detail.headId;
        changeOutbox((entries) => markConflict(queueEdit(entries, { project: s.project, key: s.key, photoId: s.photoId, accountId: accounts.current.get(s.project) ?? null }, Date.now()), s.project, s.key, headId));
        const theirs = await client.revision(s.project, s.key, error.detail.headId).then((r) => (r.recipe?.edit ?? null) as Record<string, unknown> | null).catch(() => null);
        if (!s.closed) setState({ kind: 'conflict', headId: error.detail.headId, theirs });
        return;
      }
      if (!s.closed) failed(error);
    }
  }, [client, failed, changeOutbox]);

  const pull = useCallback(async (headId: string) => {
    const s = session.current;
    if (!s) return;
    const revision = await client.revision(s.project, s.key, headId);
    if (s.closed) return;
    sourceRef.current.applySharedEdit?.(s.photoId, (revision.recipe?.edit ?? null) as Record<string, unknown> | null);
    // The engine may tidy the edit as it applies it, so the fingerprint is taken from what it holds next.
    writePoint(pointKey(s.project, s.key), { revisionId: headId, recipeHash: PENDING });
  }, [client]);

  /** Open the photo: who has it, and what to do about the shared copy. */
  const open = useCallback(async () => {
    const s = session.current;
    if (!s) return;
    try {
      let role = roles.current.get(s.project);
      if (!role) { const me = (await client.project(s.project)).me; role = me.role; roles.current.set(s.project, role); accounts.current.set(s.project, me.accountId); }
      if (s.closed) return;
      if (role !== 'owner' && role !== 'editor') { s.opened = true; setState({ kind: 'view-only', role }); return; }
      const [leases, history] = await Promise.all([client.leases(s.project), client.history(s.project, s.key)]);
      if (s.closed) return;
      s.opened = true;
      const lease = leases.find((entry) => entry.photoId === s.key);
      if (lease && !lease.mine) { setState({ kind: 'theirs', holder: lease.holder }); return; }
      const edit = sourceRef.current.sharedEditOf?.(s.photoId) ?? null;
      const plan = planSync(readPoints()[pointKey(s.project, s.key)] ?? null, recipeFingerprint(edit), history.headId, edit === null);
      if (plan.action === 'pull') { await pull(plan.headId); changeOutbox((entries) => settleEdit(entries, s.project, s.key)); setState({ kind: 'ready' }); }
      else if (plan.action === 'push') { await publish(plan.baseRevisionId); }
      else if (plan.action === 'conflict') {
        changeOutbox((entries) => markConflict(queueEdit(entries, { project: s.project, key: s.key, photoId: s.photoId, accountId: accounts.current.get(s.project) ?? null }, Date.now()), s.project, s.key, plan.headId));
        const theirs = await client.revision(s.project, s.key, plan.headId).then((r) => (r.recipe?.edit ?? null) as Record<string, unknown> | null).catch(() => null);
        if (!s.closed) setState({ kind: 'conflict', headId: plan.headId, theirs });
      } else {
        changeOutbox((entries) => settleEdit(entries, s.project, s.key));
        if (history.headId === null && edit === null) writePoint(pointKey(s.project, s.key), { revisionId: null, recipeHash: recipeFingerprint(null) });
        setState({ kind: 'ready' });
      }
    } catch (error) { if (!s.closed) failed(error); }
  }, [client, failed, publish, pull, changeOutbox]);

  // A role can change (the owner promotes or removes someone): ask again when Share closes.
  useEffect(() => { roles.current.clear(); accounts.current.clear(); }, [refreshKey]);

  // A new photo (or project): check the last one in, then open this one.
  useEffect(() => {
    if (!shared || !photoId) { setState({ kind: 'off' }); return; }
    if (!sharedKey) { setState({ kind: 'no-key' }); return; }
    const s = { project: shared, key: sharedKey, photoId, token: null as string | null, opened: false, lastChangeMs: 0, publishTimer: null as ReturnType<typeof setTimeout> | null, closed: false };
    session.current = s;
    setState({ kind: 'ready' });
    void open();
    const heartbeat = setInterval(() => {
      if (!s.token) return;
      client.heartbeat(s.project, s.key, s.token, Date.now() - s.lastChangeMs < HEARTBEAT_MS).catch((error) => { if (!s.closed) failed(error); });
    }, HEARTBEAT_MS);
    const retry = () => { if (!s.closed && stateRef.current.kind === 'draft') void open(); };
    const retryTimer = setInterval(retry, RETRY_MS);
    // Someone else's checkout ends when they move on or it lapses: look again now and then.
    const recheck = setInterval(() => { if (!s.closed && stateRef.current.kind === 'theirs') void open(); }, HEARTBEAT_MS);
    window.addEventListener('online', retry);
    return () => {
      s.closed = true;
      clearInterval(heartbeat); clearInterval(retryTimer); clearInterval(recheck); window.removeEventListener('online', retry);
      const finish = async () => {
        if (s.publishTimer) { clearTimeout(s.publishTimer); s.publishTimer = null; await publish(undefined, s); }
        if (s.token) await client.release(s.project, s.key, s.token, 'checked-in').catch(() => undefined);
      };
      void finish();
      if (session.current === s) session.current = null;
    };
  }, [shared, photoId, sharedKey, client, open, publish, failed, refreshKey]);

  // Every change to the photo's edit: record the pulled fingerprint, or check out and share a moment later.
  useEffect(() => {
    const s = session.current;
    if (!s || s.closed || !s.opened || s.photoId !== photoId) return;
    const key = pointKey(s.project, s.key);
    const point = readPoints()[key];
    const hash = localHash(s.photoId);
    if (point?.recipeHash === PENDING) { writePoint(key, { revisionId: point.revisionId, recipeHash: hash }); return; }
    if (point && point.recipeHash === hash) return;
    const kind = stateRef.current.kind;
    if (kind === 'theirs' || kind === 'conflict' || kind === 'no-key' || kind === 'view-only') return;
    if (!point && kind === 'ready' && hash === recipeFingerprint(null)) return;
    s.lastChangeMs = Date.now();
    // Listed before anything is sent, so the edit is shared later even if the app closes or the network drops first.
    changeOutbox((entries) => queueEdit(entries, { project: s.project, key: s.key, photoId: s.photoId, accountId: accounts.current.get(s.project) ?? null }, s.lastChangeMs));
    if (!s.token) {
      client.acquire(s.project, s.key, deviceId()).then((lease) => { if (!s.closed) { s.token = lease.token; setState({ kind: 'mine' }); } }).catch((error) => { if (!s.closed) failed(error); });
    }
    if (s.publishTimer) clearTimeout(s.publishTimer);
    s.publishTimer = setTimeout(() => { s.publishTimer = null; void publish(); }, PUBLISH_AFTER_MS);
  }, [changeSignal, photoId, client, failed, localHash, publish, changeOutbox]);

  const keepMine = useCallback(() => {
    const current = stateRef.current;
    if (current.kind !== 'conflict') return;
    void publish(current.headId);
  }, [publish]);

  const keepTheirs = useCallback(() => {
    const current = stateRef.current;
    const s = session.current;
    if (current.kind !== 'conflict' || !s) return;
    sourceRef.current.applySharedEdit?.(s.photoId, current.theirs);
    writePoint(pointKey(s.project, s.key), { revisionId: current.headId, recipeHash: PENDING });
    changeOutbox((entries) => settleEdit(entries, s.project, s.key));
    setState({ kind: 'ready' });
  }, [changeOutbox]);

  /** Both: this device's edit becomes a virtual copy (shared as its own photo when opened); the photo takes theirs. */
  const keepBoth = useCallback(() => {
    const current = stateRef.current;
    const s = session.current;
    if (current.kind !== 'conflict' || !s || !sourceRef.current.keepBothShared) return;
    if (sourceRef.current.keepBothShared(s.photoId, current.theirs) === null) return;
    writePoint(pointKey(s.project, s.key), { revisionId: current.headId, recipeHash: PENDING });
    changeOutbox((entries) => settleEdit(entries, s.project, s.key));
    setState({ kind: 'ready' });
  }, [changeOutbox]);

  /**
   * Shares queued edits of photos that are not on screen, oldest first. One photo at a time: check it out, compare with
   * the shared head, publish only if nobody else changed it, check it back in. Stops at the first sign of being offline.
   */
  const flushing = useRef(false);
  const flushQueued = useCallback(async (project: string, force: boolean) => {
    if (flushing.current || !sourceRef.current.sharedEditOf) return;
    flushing.current = true;
    try {
      if (!readStoredOutbox().some((entry) => entry.project === project && entry.state === 'pending')) return;
      let accountId = accounts.current.get(project);
      if (!accountId) {
        const me = (await client.project(project)).me;
        roles.current.set(project, me.role); accounts.current.set(project, me.accountId); accountId = me.accountId;
      }
      if (roles.current.get(project) !== 'owner' && roles.current.get(project) !== 'editor') return;
      await flushOutbox(project, accountId, {
        acquire: (p, key) => client.acquire(p, key, deviceId()),
        history: (p, key) => client.history(p, key),
        publish: (p, key, request) => client.publish(p, key, request),
        release: (p, key, token) => client.release(p, key, token, 'checked-in'),
        classify: (error) => error instanceof CollabError && error.code === 'COLLAB_STALE_BASE' && typeof error.detail.headId === 'string' ? { kind: 'stale', headId: error.detail.headId }
          : error instanceof CollabError && error.code === 'COLLAB_PHOTO_CHECKED_OUT' ? { kind: 'checked-out' } : { kind: 'other' },
        editOf: (id) => sourceRef.current.sharedEditOf?.(id) ?? null,
        exists: (id) => sourceRef.current.sharedPhotoExists?.(id) !== false,
        pointOf: (p, key) => readPoints()[pointKey(p, key)] ?? null,
        setPoint: (p, key, point) => writePoint(pointKey(p, key), point),
        fingerprint: recipeFingerprint,
        read: readStoredOutbox,
        change: changeOutbox,
        now: Date.now,
      }, { skipKey: session.current?.project === project ? session.current.key : null, force });
    } catch { /* offline or signed out: the queue stays as it is */ } finally { flushing.current = false; }
  }, [client, changeOutbox]);

  useEffect(() => {
    if (!shared) return;
    const first = setTimeout(() => { void flushQueued(shared, false); }, OUTBOX_FIRST_TRY_MS);
    const timer = setInterval(() => { void flushQueued(shared, false); }, RETRY_MS);
    const online = () => { void flushQueued(shared, true); };
    const storage = (event: StorageEvent) => { if (event.key === OUTBOX_KEY) setOutbox(readStoredOutbox()); };
    window.addEventListener('online', online);
    window.addEventListener('storage', storage);
    return () => { clearTimeout(first); clearInterval(timer); window.removeEventListener('online', online); window.removeEventListener('storage', storage); };
  }, [shared, flushQueued, refreshKey]);

  const retry = useCallback(() => { void open(); if (shared) void flushQueued(shared, true); }, [open, shared, flushQueued]);
  const pending: OutboxSummary = outboxSummary(outbox, shared, sharedKey);

  return { state, keepMine, keepTheirs, keepBoth: source.keepBothShared ? keepBoth : undefined, retry, outbox: pending };
}

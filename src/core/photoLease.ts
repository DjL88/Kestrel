/**
 * C02 — per-photo checkout and check-in (#1387). A lease, not a lock that can be lost forever: it lapses by itself when
 * its holder stops sending heartbeats (closed laptop, crash, lost network) or stops editing, so nobody needs an
 * administrator to free a photo. Five people can hold five photos at once. Pure: the server runs these same rules
 * inside a transaction and issues the token; the app never trusts its own clock for someone else's lease.
 */

export interface LeaseSettings {
  heartbeatMs: number;
  /** No heartbeat for this long: the holder is treated as gone. */
  networkExpiryMs: number;
  /** No editing for this long: warn the holder. */
  inactivityWarningMs: number;
  /** No editing for this long: release. */
  inactivityReleaseMs: number;
}

/** The proposal's defaults. The project owner may change them (clampLeaseSettings keeps them coherent). */
export const DEFAULT_LEASE_SETTINGS: LeaseSettings = {
  heartbeatMs: 30_000,
  networkExpiryMs: 120_000,
  inactivityWarningMs: 8 * 60_000,
  inactivityReleaseMs: 10 * 60_000,
};

/** Keeps owner-chosen timings sensible: at least two heartbeats before expiry, and the warning before the release. */
export function clampLeaseSettings(input: Partial<LeaseSettings>): LeaseSettings {
  const pick = (value: number | undefined, fallback: number, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
  const heartbeatMs = pick(input.heartbeatMs, DEFAULT_LEASE_SETTINGS.heartbeatMs, 5_000, 120_000);
  const networkExpiryMs = pick(input.networkExpiryMs, DEFAULT_LEASE_SETTINGS.networkExpiryMs, heartbeatMs * 2, 30 * 60_000);
  const inactivityReleaseMs = pick(input.inactivityReleaseMs, DEFAULT_LEASE_SETTINGS.inactivityReleaseMs, 60_000, 4 * 60 * 60_000);
  const inactivityWarningMs = pick(input.inactivityWarningMs, Math.max(30_000, inactivityReleaseMs - 2 * 60_000), 30_000, inactivityReleaseMs - 30_000);
  return { heartbeatMs, networkExpiryMs, inactivityWarningMs, inactivityReleaseMs };
}

export interface PhotoLease {
  photoId: string;
  holderAccountId: string;
  holderDeviceId: string;
  /** Issued by the server. Every save and heartbeat must present it. */
  token: string;
  /** The shared revision the holder started from (sharedRevisions.ts). */
  baseRevisionId: string | null;
  acquiredAtMs: number;
  lastHeartbeatMs: number;
  lastActivityMs: number;
}

export type LeaseAction = 'acquired' | 'renewed' | 'checked-in' | 'released' | 'expired' | 'overridden';

export interface LeaseAuditEntry {
  atMs: number;
  photoId: string;
  action: LeaseAction;
  actorAccountId: string;
  holderAccountId: string;
  reason?: string;
}

export interface LeaseBoard {
  leases: Readonly<Record<string, PhotoLease>>;
  audit: readonly LeaseAuditEntry[];
}

export const EMPTY_LEASE_BOARD: LeaseBoard = { leases: {}, audit: [] };

export type LeaseStatus =
  | { state: 'active' }
  | { state: 'idle-warning'; releasesAtMs: number }
  | { state: 'expired'; cause: 'network' | 'inactive' };

export function leaseStatus(lease: PhotoLease, nowMs: number, settings: LeaseSettings = DEFAULT_LEASE_SETTINGS): LeaseStatus {
  if (nowMs - lease.lastHeartbeatMs >= settings.networkExpiryMs) return { state: 'expired', cause: 'network' };
  const idle = nowMs - lease.lastActivityMs;
  if (idle >= settings.inactivityReleaseMs) return { state: 'expired', cause: 'inactive' };
  if (idle >= settings.inactivityWarningMs) return { state: 'idle-warning', releasesAtMs: lease.lastActivityMs + settings.inactivityReleaseMs };
  return { state: 'active' };
}

/** The lease that currently counts for a photo, or undefined when it is free (including when the last one lapsed). */
export function liveLease(board: LeaseBoard, photoId: string, nowMs: number, settings: LeaseSettings = DEFAULT_LEASE_SETTINGS): PhotoLease | undefined {
  const lease = board.leases[photoId];
  return lease && leaseStatus(lease, nowMs, settings).state !== 'expired' ? lease : undefined;
}

export interface LeaseRequest {
  photoId: string;
  accountId: string;
  deviceId: string;
  token: string;
  baseRevisionId: string | null;
}

export type AcquireResult =
  | { ok: true; board: LeaseBoard; lease: PhotoLease }
  /** `sameAccount` means the person holds it on another device: finish or release there first, so two of their own devices never overwrite each other. */
  | { ok: false; reason: 'held'; holderAccountId: string; sameAccount: boolean };

function withLease(board: LeaseBoard, lease: PhotoLease | null, photoId: string, entries: LeaseAuditEntry[]): LeaseBoard {
  const leases = { ...board.leases };
  if (lease) leases[photoId] = lease; else delete leases[photoId];
  return { leases, audit: [...board.audit, ...entries] };
}

/**
 * Called on the first editing action on a photo, not from a button. Renews when the same device already holds it.
 * Whether the account may edit at all is collabRoles.can(…, 'edit', photoId); check that first.
 */
export function acquireLease(board: LeaseBoard, request: LeaseRequest, nowMs: number, settings: LeaseSettings = DEFAULT_LEASE_SETTINGS): AcquireResult {
  const existing = board.leases[request.photoId];
  const entries: LeaseAuditEntry[] = [];
  if (existing) {
    const status = leaseStatus(existing, nowMs, settings);
    if (status.state !== 'expired') {
      if (existing.holderAccountId === request.accountId && existing.holderDeviceId === request.deviceId) {
        const lease = { ...existing, lastHeartbeatMs: nowMs, lastActivityMs: nowMs };
        return { ok: true, board: withLease(board, lease, request.photoId, []), lease };
      }
      return { ok: false, reason: 'held', holderAccountId: existing.holderAccountId, sameAccount: existing.holderAccountId === request.accountId };
    }
    entries.push({ atMs: nowMs, photoId: request.photoId, action: 'expired', actorAccountId: request.accountId, holderAccountId: existing.holderAccountId, reason: status.cause });
  }
  const lease: PhotoLease = {
    photoId: request.photoId, holderAccountId: request.accountId, holderDeviceId: request.deviceId, token: request.token,
    baseRevisionId: request.baseRevisionId, acquiredAtMs: nowMs, lastHeartbeatMs: nowMs, lastActivityMs: nowMs,
  };
  entries.push({ atMs: nowMs, photoId: request.photoId, action: 'acquired', actorAccountId: request.accountId, holderAccountId: request.accountId });
  return { ok: true, board: withLease(board, lease, request.photoId, entries), lease };
}

export type LeaseUpdate = { ok: true; board: LeaseBoard } | { ok: false; reason: 'not-held' | 'lapsed' | 'reason-required' };

function heldBy(board: LeaseBoard, photoId: string, token: string, nowMs: number, settings: LeaseSettings): PhotoLease | 'not-held' | 'lapsed' {
  const lease = board.leases[photoId];
  if (!lease || lease.token !== token) return 'not-held';
  return leaseStatus(lease, nowMs, settings).state === 'expired' ? 'lapsed' : lease;
}

/**
 * Sent every heartbeatMs while the photo is open. `editing` is true when the person changed something, or when
 * legitimate background processing for this photo (a render, Auto, denoise) is still running on their behalf.
 */
export function heartbeat(board: LeaseBoard, photoId: string, token: string, nowMs: number, editing: boolean, settings: LeaseSettings = DEFAULT_LEASE_SETTINGS): LeaseUpdate {
  const lease = heldBy(board, photoId, token, nowMs, settings);
  if (typeof lease === 'string') return { ok: false, reason: lease };
  return { ok: true, board: withLease(board, { ...lease, lastHeartbeatMs: nowMs, lastActivityMs: editing ? nowMs : lease.lastActivityMs }, photoId, []) };
}

/** Check in after the edits are safely saved (`checked-in`), or let go without saving anything new (`released`). */
export function releaseLease(board: LeaseBoard, photoId: string, token: string, nowMs: number, action: 'checked-in' | 'released'): LeaseUpdate {
  const lease = board.leases[photoId];
  if (!lease || lease.token !== token) return { ok: false, reason: 'not-held' };
  return { ok: true, board: withLease(board, null, photoId, [{ atMs: nowMs, photoId, action, actorAccountId: lease.holderAccountId, holderAccountId: lease.holderAccountId }]) };
}

/**
 * Releases someone else's lease. Only for an account allowed `releaseOthersLock` (the caller checks collabRoles), and
 * only with a reason, which goes in the audit trail. The previous holder's unsaved work stays on their device as a draft.
 */
export function overrideLease(board: LeaseBoard, photoId: string, actorAccountId: string, reason: string, nowMs: number): LeaseUpdate {
  const lease = board.leases[photoId];
  if (!lease) return { ok: false, reason: 'not-held' };
  if (!reason.trim()) return { ok: false, reason: 'reason-required' };
  return { ok: true, board: withLease(board, null, photoId, [{ atMs: nowMs, photoId, action: 'overridden', actorAccountId, holderAccountId: lease.holderAccountId, reason: reason.trim() }]) };
}

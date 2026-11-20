import { mayUseMaster, type MasterHandoff, type MasterRequest } from './rawMasterHandoff';

/**
 * Pre-commit identity fence for high-precision output.
 *
 * prepare() may create a private, disposable staging artifact, NEVER a visible
 * destination file. commit() must atomically publish it without overwriting an
 * existing output; discard() must be idempotent. The adapter is responsible for
 * actual source-byte hashing and atomic filesystem publication.
 *
 * A matching path, file size, mtime or catalogue ID alone is not proof.
 * The original must be hashed independently at both fences. This module
 * does not perform RAW decoding or grant codec distribution rights.
 */
export interface OriginalIdentity {
  sourceId: string;
  generation: number;
  originalSha256: string;
}
export interface MasterConsumptionAdapter<T> {
  /** Re-hash original bytes from a trusted source handle, not a preview. */
  readOriginalIdentity(signal?: AbortSignal): Promise<OriginalIdentity>;
  /** Stage an immutable output; do not publish to a user-visible path. */
  prepare(handoff: Extract<MasterHandoff, { state: 'verified' }>, signal?: AbortSignal): Promise<T>;
  /** Atomically publish without replacing an existing file. */
  commit(staged: T, signal?: AbortSignal): Promise<void>;
  /** Clean staging on every failure, including a failed commit. */
  discard(staged: T): Promise<void>;
}
export type ConsumptionResult =
  | { ok: true; cleanupFailed?: boolean }
  | { ok: false; reason: 'unverified-master' | 'cancelled' | 'original-changed' | 'preparation-failed' | 'commit-failed'; cleanupFailed?: boolean };

const SHA = /^[a-f0-9]{64}$/i;
function matches(actual: OriginalIdentity, request: MasterRequest): boolean {
  return actual.sourceId === request.sourceId &&
    actual.generation === request.generation &&
    SHA.test(actual.originalSha256) &&
    actual.originalSha256.toLowerCase() === request.expectedOriginalSha256.toLowerCase();
}
function cancelled(signal?: AbortSignal): boolean { return signal?.aborted === true; }

/**
 * A failed identity fence never calls commit. Cancellation before commit also
 * never publishes. Cancellation during an atomic commit is adapter-defined:
 * the adapter must either publish the complete file or publish nothing.
 */
export async function consumeVerifiedMaster<T>(
  handoff: MasterHandoff,
  request: MasterRequest,
  adapter: MasterConsumptionAdapter<T>,
  signal?: AbortSignal,
): Promise<ConsumptionResult> {
  if (handoff.state !== 'verified' || !mayUseMaster(handoff, request)) return { ok: false, reason: 'unverified-master' };
  if (cancelled(signal)) return { ok: false, reason: 'cancelled' };
  try {
    if (!matches(await adapter.readOriginalIdentity(signal), request)) return { ok: false, reason: 'original-changed' };
  } catch {
    return { ok: false, reason: cancelled(signal) ? 'cancelled' : 'original-changed' };
  }
  if (cancelled(signal)) return { ok: false, reason: 'cancelled' };

  let staged: T;
  try {
    staged = await adapter.prepare(handoff, signal);
  } catch {
    return { ok: false, reason: cancelled(signal) ? 'cancelled' : 'preparation-failed' };
  }
  // Preserve the publication result even when cleanup itself fails. In particular,
  // a successfully published file must not be reported as a failed commit: a
  // caller retrying that apparent failure could collide with its own output.
  let result: ConsumptionResult;
  if (cancelled(signal)) {
    result = { ok: false, reason: 'cancelled' };
  } else {
    try {
      result = matches(await adapter.readOriginalIdentity(signal), request)
        ? { ok: true }
        : { ok: false, reason: 'original-changed' };
    } catch {
      result = { ok: false, reason: cancelled(signal) ? 'cancelled' : 'original-changed' };
    }
    if (cancelled(signal)) result = { ok: false, reason: 'cancelled' };
    if (result.ok) {
      try {
        await adapter.commit(staged, signal);
      } catch {
        result = { ok: false, reason: 'commit-failed' };
      }
    }
  }
  try {
    await adapter.discard(staged);
  } catch {
    // A cleanup error needs reporting, but cannot change whether commit ran.
    return { ...result, cleanupFailed: true };
  }
  return result;
}

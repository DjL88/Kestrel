/**
 * Optional, explicit backup synchronisation. The application remains usable offline.
 * A provider adapter owns authentication and transport; never place credentials in this module.
 * These are project/recipe backups, NOT camera originals.
 */
export interface BackupObject {
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly etag: string;
}
export interface BackupRemote {
  /** Returns null when absent; implementations must not return stale cached objects for writes. */
  read(key: string, signal?: AbortSignal): Promise<BackupObject | null>;
  /** Atomic create-if-absent, never overwrite. Return false for an existing key. */
  create(key: string, bytes: Uint8Array, signal?: AbortSignal): Promise<boolean>;
  /** Atomic compare-and-swap; null means create-if-absent. No partial publication. */
  compareAndSwap(key: string, expectedEtag: string | null, bytes: Uint8Array, signal?: AbortSignal): Promise<boolean>;
}
export interface BackupHead {
  schema: 1;
  revision: number;
  blobKey: string;
  sha256: string;
  bytes: number;
}
export interface BackupAnchor { revision: number; sha256: string }
const HASH = /^[0-9a-f]{64}$/;
const KEY = /^kestrel\/backups\/[a-z0-9-]{1,64}\/objects\/[0-9a-f]{64}\.json$/;
const HEAD = /^kestrel\/backups\/[a-z0-9-]{1,64}\/head\.json$/;
const LIMIT = 32 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
function ensureActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Backup operation cancelled');
}
export async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
}
function parseHead(bytes: Uint8Array, prefix: string): BackupHead {
  if (bytes.byteLength > 4096) throw new Error('Invalid backup head size');
  const data: unknown = JSON.parse(decoder.decode(bytes));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid backup head');
  const x = data as Record<string, unknown>;
  if (Object.keys(x).sort().join(',') !== 'blobKey,bytes,revision,schema,sha256' ||
    x.schema !== 1 || !Number.isSafeInteger(x.revision) || (x.revision as number) < 1 ||
    typeof x.sha256 !== 'string' || !HASH.test(x.sha256) ||
    !Number.isSafeInteger(x.bytes) || (x.bytes as number) < 1 || (x.bytes as number) > LIMIT ||
    typeof x.blobKey !== 'string' || !KEY.test(x.blobKey) ||
    !x.blobKey.startsWith(prefix + '/objects/') ||
    x.blobKey !== prefix + '/objects/' + x.sha256 + '.json')
    throw new Error('Invalid backup head');
  return x as unknown as BackupHead;
}
function scope(projectId: string): string {
  if (!/^[a-z0-9-]{1,64}$/.test(projectId)) throw new Error('Invalid project ID');
  return 'kestrel/backups/' + projectId;
}
function validateAnchor(anchor: BackupAnchor | null): void {
  if (anchor !== null && (!Number.isSafeInteger(anchor.revision) || anchor.revision < 1 || !HASH.test(anchor.sha256)))
    throw new Error('Invalid local backup anchor');
}
async function verifiedHead(remote: BackupRemote, prefix: string, signal?: AbortSignal) {
  ensureActive(signal);
  const obj = await remote.read(prefix + '/head.json', signal);
  ensureActive(signal);
  return obj ? { head: parseHead(obj.bytes, prefix), etag: obj.etag } : null;
}
function checkAnchor(remoteHead: BackupHead | null, anchor: BackupAnchor | null): void {
  if (!anchor) return;
  if (!remoteHead || remoteHead.revision < anchor.revision ||
      (remoteHead.revision === anchor.revision && remoteHead.sha256 !== anchor.sha256))
    throw new Error('Remote backup rollback or fork detected');
}
/** Verify the remote object and manifest before allowing the caller to parse a project backup. */
export async function readVerifiedBackup(remote: BackupRemote, projectId: string, anchor: BackupAnchor | null,
  signal?: AbortSignal): Promise<{ bytes: Uint8Array; anchor: BackupAnchor } | null> {
  validateAnchor(anchor);
  const prefix = scope(projectId);
  const state = await verifiedHead(remote, prefix, signal);
  checkAnchor(state?.head ?? null, anchor);
  if (!state) return null;
  const object = await remote.read(state.head.blobKey, signal);
  ensureActive(signal);
  if (!object || object.bytes.byteLength !== state.head.bytes ||
      await digest(object.bytes) !== state.head.sha256) throw new Error('Backup content verification failed');
  ensureActive(signal);
  return { bytes: Uint8Array.from(object.bytes), anchor: { revision: state.head.revision, sha256: state.head.sha256 } };
}
/**
 * Write immutable content first; publish a small pointer only after verifying the remote bytes.
 * The caller MUST durably save the returned anchor before reporting success.
 * Failure never deletes local edits or the original photographs.
 */
export async function publishBackup(remote: BackupRemote, projectId: string, bytes: Uint8Array,
  anchor: BackupAnchor | null, signal?: AbortSignal): Promise<BackupAnchor> {
  validateAnchor(anchor);
  const prefix = scope(projectId);
  if (!bytes.byteLength || bytes.byteLength > LIMIT) throw new Error('Backup size outside limits');
  ensureActive(signal);
  const sha256 = await digest(bytes);
  const current = await verifiedHead(remote, prefix, signal);
  checkAnchor(current?.head ?? null, anchor);
  // Refuse a blind write over an existing remote backup, even if the local anchor is absent.
  if (current && !anchor) throw new Error('Existing remote backup requires verified local anchor');
  if (current && anchor && (current.head.revision !== anchor.revision || current.head.sha256 !== anchor.sha256))
    throw new Error('Remote backup changed; restore or reconcile before upload');
  const blobKey = prefix + '/objects/' + sha256 + '.json';
  const created = await remote.create(blobKey, Uint8Array.from(bytes), signal);
  ensureActive(signal);
  const stored = await remote.read(blobKey, signal);
  ensureActive(signal);
  if (!stored || stored.bytes.byteLength !== bytes.byteLength || await digest(stored.bytes) !== sha256)
    throw new Error('Remote backup bytes did not verify');
  ensureActive(signal);
  // An existing content-addressed object is acceptable only after byte verification.
  void created;
  const revision = (current?.head.revision ?? 0) + 1;
  const head: BackupHead = { schema: 1, revision, blobKey, sha256, bytes: bytes.byteLength };
  const ok = await remote.compareAndSwap(prefix + '/head.json', current?.etag ?? null,
    encoder.encode(JSON.stringify(head)), signal);
  ensureActive(signal);
  if (!ok) throw new Error('Concurrent remote backup update; no pointer was published');
  return { revision, sha256 };
}

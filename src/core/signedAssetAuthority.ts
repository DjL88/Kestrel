/** Pinned, signed data-only asset catalogue authority for offline model/lens/knowledge packs.
 * Never downloads files, executes code or accesses photos. Publisher keys ship with the app.
 * The sequence ledger MUST be durable and atomic across processes/devices sharing a store.
 */
import type { ApprovedAsset, AssetKind } from './verifiedAssetActivation';
import type { VerifiedManifestAuthority } from './offlineAssetRuntime';

export interface SignedAssetEnvelope {
  keyId: string;
  payload: Uint8Array;
  signature: Uint8Array;
}
export interface SequenceFence {
  read(): Promise<{ sequence: number; digest: string } | undefined>;
  /** Durable atomic CAS; true only after transaction commit/fsync. */
  compareAndSwap(
    expected: { sequence: number; digest: string } | undefined,
    next: { sequence: number; digest: string },
  ): Promise<boolean>;
}
export interface SignedAssetPolicy {
  /** Only app-pinned, audited Ed25519 verification keys. */
  keys: ReadonlyMap<string, CryptoKey>;
  fence: SequenceFence;
  now?: () => Date;
  maxManifestBytes?: number;
}
const ID = /^[a-z][a-z0-9._-]{0,127}$/;
const SHA = /^[a-f0-9]{64}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const KINDS = new Set<AssetKind>(['model', 'lens-db', 'knowledge', 'labels', 'camera-record']);
const decoder = new TextDecoder('utf-8', { fatal: true });
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const hash = async (bytes: Uint8Array): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    x => x.toString(16).padStart(2, '0')).join('');

function parseAsset(v: unknown): ApprovedAsset {
  if (!record(v) || typeof v.id !== 'string' || !ID.test(v.id) ||
      typeof v.version !== 'string' || !VERSION.test(v.version) ||
      typeof v.kind !== 'string' || !KINDS.has(v.kind as AssetKind) ||
      typeof v.sha256 !== 'string' || !SHA.test(v.sha256) ||
      !Number.isSafeInteger(v.bytes) || (v.bytes as number) <= 0 ||
      (v.bytes as number) > 2_147_483_648 ||
      typeof v.licence !== 'string' || !v.licence.trim() ||
      typeof v.provenance !== 'string' || !v.provenance.trim() ||
      v.approved !== true || v.executable === true ||
      (v.minAppVersion !== undefined && (typeof v.minAppVersion !== 'string' ||
        !VERSION.test(v.minAppVersion))) ||
      (v.maxRamBytes !== undefined && (!Number.isSafeInteger(v.maxRamBytes) ||
        (v.maxRamBytes as number) <= 0))) {
    throw new Error('Unapproved, executable or malformed asset entry');
  }
  return { id: v.id, version: v.version, kind: v.kind as AssetKind,
    sha256: v.sha256, bytes: v.bytes as number, licence: v.licence,
    provenance: v.provenance, approved: true,
    ...(v.minAppVersion === undefined ? {} : { minAppVersion: v.minAppVersion as string }),
    ...(v.maxRamBytes === undefined ? {} : { maxRamBytes: v.maxRamBytes as number }) };
}

/** Signature covers the exact UTF-8 bytes, not reserialised JSON.
 * A committed sequence is bound to its digest: same-sequence equivocation fails.
 * Persisting the fence before asset staging may reject a failed update's old
 * sequence, but the exact same signed manifest is safely retryable.
 */
export function createSignedAssetAuthority(policy: SignedAssetPolicy):
  VerifiedManifestAuthority<SignedAssetEnvelope> {
  return {
    async verify(envelope) {
      if (!ID.test(envelope.keyId) ||
          !(envelope.payload instanceof Uint8Array) ||
          !(envelope.signature instanceof Uint8Array) ||
          envelope.signature.byteLength !== 64 ||
          envelope.payload.byteLength === 0 ||
          envelope.payload.byteLength > (policy.maxManifestBytes ?? 262_144))
        throw new Error('Invalid signed asset envelope');
      const key = policy.keys.get(envelope.keyId);
      if (!key || key.type !== 'public' || key.algorithm.name !== 'Ed25519' ||
          !key.usages.includes('verify') ||
          !await crypto.subtle.verify('Ed25519', key, envelope.signature, envelope.payload))
        throw new Error('Untrusted asset catalogue signature');
      const data: unknown = JSON.parse(decoder.decode(envelope.payload));
      if (!record(data) || data.schema !== 1 ||
          !Number.isSafeInteger(data.sequence) || (data.sequence as number) < 1 ||
          typeof data.expiresAt !== 'string' ||
          !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(data.expiresAt) ||
          !Number.isFinite(Date.parse(data.expiresAt)) ||
          Date.parse(data.expiresAt) <= (policy.now?.() ?? new Date()).getTime() ||
          !Array.isArray(data.assets) || data.assets.length > 256)
        throw new Error('Expired or malformed signed asset catalogue');
      const assets = data.assets.map(parseAsset);
      if (new Set(assets.map(a => a.id)).size !== assets.length)
        throw new Error('Duplicate signed asset identifier');
      const next = { sequence: data.sequence as number, digest: await hash(envelope.payload) };
      // Bounded CAS retries handle concurrent installers, without accepting rollback.
      for (let attempt = 0; attempt < 5; attempt++) {
        const current = await policy.fence.read();
        if (current) {
          if (!Number.isSafeInteger(current.sequence) || !SHA.test(current.digest))
            throw new Error('Corrupt persistent asset sequence fence');
          if (current.sequence > next.sequence ||
              (current.sequence === next.sequence && current.digest !== next.digest))
            throw new Error('Signed asset catalogue rollback or equivocation');
          if (current.sequence === next.sequence) return assets;
        }
        if (await policy.fence.compareAndSwap(current, next)) return assets;
      }
      throw new Error('Asset sequence fence contention');
    },
  };
}

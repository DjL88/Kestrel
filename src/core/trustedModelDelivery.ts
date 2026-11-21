/** Offline-first, fail-closed model delivery boundary. Never fetches a URL or stores credentials. */
export interface TrustedModel {
  id: string;
  version: number;
  path: string;
  sha256: string;
  bytes: number;
}
export interface TrustedManifest {
  schema: 1;
  sequence: number;
  expiresAt: string;
  models: TrustedModel[];
}
export interface SignedManifestEnvelope {
  keyId: string;
  payload: Uint8Array;
  signature: Uint8Array;
}
export interface TrustPolicy {
  /** Ed25519 public keys are pinned by the installed application, never supplied by the feed. */
  keys: ReadonlyMap<string, CryptoKey>;
  minimumSequence: number;
  now?: Date;
  maxManifestBytes?: number;
}
const HEX = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const PATH = /^(?:[a-zA-Z0-9._-]+\/)*[a-zA-Z0-9._-]+\.(?:onnx|tflite)$/;
const decoder = new TextDecoder('utf-8', { fatal: true });
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validPath(path: string): boolean {
  return PATH.test(path) && path.split('/').every(part => part !== '.' && part !== '..' && !part.startsWith('.'));
}
export async function verifySignedModelManifest(
  envelope: SignedManifestEnvelope,
  policy: TrustPolicy,
): Promise<TrustedManifest> {
  if (!ID.test(envelope.keyId) || !(envelope.payload instanceof Uint8Array) ||
      !(envelope.signature instanceof Uint8Array) || envelope.signature.byteLength !== 64 ||
      envelope.payload.byteLength === 0 || envelope.payload.byteLength > (policy.maxManifestBytes ?? 262144)) {
    throw new Error('Invalid signed model manifest envelope');
  }
  const key = policy.keys.get(envelope.keyId);
  if (!key || key.algorithm.name !== 'Ed25519' || key.type !== 'public' ||
      !key.usages.includes('verify') ||
      !(await crypto.subtle.verify('Ed25519', key, envelope.signature as BufferSource, envelope.payload as BufferSource))) {
    throw new Error('Model manifest signature not trusted');
  }
  const raw: unknown = JSON.parse(decoder.decode(envelope.payload));
  if (!object(raw) || raw.schema !== 1 || !Number.isSafeInteger(raw.sequence) ||
      (raw.sequence as number) < policy.minimumSequence ||
      typeof raw.expiresAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(raw.expiresAt) ||
      !Number.isFinite(Date.parse(raw.expiresAt)) ||
      Date.parse(raw.expiresAt) <= (policy.now ?? new Date()).getTime() ||
      !Array.isArray(raw.models) || raw.models.length > 256) {
    throw new Error('Model manifest expired, rolled back or malformed');
  }
  const seen = new Set<string>();
  const models: TrustedModel[] = [];
  for (const entry of raw.models) {
    if (!object(entry) || typeof entry.id !== 'string' || !ID.test(entry.id) ||
        !Number.isSafeInteger(entry.version) || (entry.version as number) < 1 ||
        typeof entry.path !== 'string' || !validPath(entry.path) ||
        typeof entry.sha256 !== 'string' || !HEX.test(entry.sha256) ||
        !Number.isSafeInteger(entry.bytes) || (entry.bytes as number) <= 0 ||
        (entry.bytes as number) > 2_147_483_648 ||
        seen.has(entry.id) || seen.has('path:' + entry.path)) {
      throw new Error('Unsafe or duplicate model entry');
    }
    seen.add(entry.id);
    seen.add('path:' + entry.path);
    models.push({ id: entry.id, version: entry.version as number, path: entry.path,
      sha256: entry.sha256, bytes: entry.bytes as number });
  }
  return { schema: 1, sequence: raw.sequence as number, expiresAt: raw.expiresAt, models };
}
/** Call before atomic publication. Caller must independently ensure no-overwrite staging and persist sequence. */
export async function verifyModelBytes(model: TrustedModel, bytes: Uint8Array): Promise<void> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== model.bytes ||
      !HEX.test(model.sha256) || !validPath(model.path)) throw new Error('Model size or path mismatch');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  const hex = Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
  if (hex !== model.sha256) throw new Error('Model content digest mismatch');
}

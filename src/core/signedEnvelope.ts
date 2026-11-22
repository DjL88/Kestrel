/**
 * One signing format shared by the InFlight control plane and every client.
 *
 * The server signs `canonicalJson(payload)` with Ed25519. Clients verify with a
 * PINNED public key (never one supplied by the response) using WebCrypto, which
 * exists in WebView2, WKWebView, Chromium and Node. Nothing here touches the
 * network or storage.
 */
export interface SignedEnvelope<T> {
  payload: T;
  /** Ed25519 signature over canonicalJson(payload), base64. */
  signature: string;
  /** Which pinned key signed it, so keys can rotate without a client release. */
  keyId: string;
}

/**
 * Deterministic JSON: object keys sorted, no whitespace, no undefined values.
 * Rejects values JSON cannot represent exactly (NaN, Infinity, functions,
 * bigint), so a signature never covers something the verifier reads differently.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean': return value ? 'true' : 'false';
    case 'string': return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
    }
    default: throw new TypeError(`canonicalJson: unsupported ${typeof value}`);
  }
}

const KEY_ID = /^[A-Za-z0-9._-]{1,64}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function fromBase64(text: string): Uint8Array<ArrayBuffer> | null {
  if (!BASE64.test(text) || text.length % 4 !== 0) return null;
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Raw 32-byte Ed25519 public keys, base64, keyed by keyId. Pinned in the client build. */
export type PinnedKeys = Readonly<Record<string, string>>;

export type EnvelopeFailure = 'malformed' | 'unknown_key' | 'bad_signature';

/** Check shape, pinned key and signature. Returns the payload only when all three hold. */
export async function openEnvelope(
  input: unknown, keys: PinnedKeys,
): Promise<{ payload: unknown } | { failure: EnvelopeFailure }> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { failure: 'malformed' };
  const envelope = input as Record<string, unknown>;
  if (typeof envelope.signature !== 'string' || typeof envelope.keyId !== 'string' ||
      !KEY_ID.test(envelope.keyId) || !Object.hasOwn(envelope, 'payload')) return { failure: 'malformed' };
  if (!Object.hasOwn(keys, envelope.keyId)) return { failure: 'unknown_key' };
  const raw = fromBase64(keys[envelope.keyId]);
  const signature = fromBase64(envelope.signature);
  if (!raw || raw.length !== 32 || !signature || signature.length !== 64) return { failure: 'malformed' };
  let message: Uint8Array<ArrayBuffer>;
  try { message = new TextEncoder().encode(canonicalJson(envelope.payload)) as Uint8Array<ArrayBuffer>; }
  catch { return { failure: 'malformed' }; }
  try {
    const key = await crypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'Ed25519' }, key, signature, message);
    return ok ? { payload: envelope.payload } : { failure: 'bad_signature' };
  } catch {
    // A runtime without Ed25519 cannot verify, so it must not trust.
    return { failure: 'bad_signature' };
  }
}

/** Lowercase hex SHA-256 of some bytes. */
export async function sha256Hex(bytes: BufferSource): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

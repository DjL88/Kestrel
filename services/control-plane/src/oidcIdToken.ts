import crypto from 'node:crypto';

/**
 * Checks an OpenID Connect ID token from a sign-in provider (Sign in with Apple, Sign in with Google for people).
 * Only an RS256 token signed by one of the provider's published keys, from the expected issuer, for one of OUR client
 * ids, unexpired, with a verified email, passes. Nothing else is trusted, including claims in an unverified token.
 */

export const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys';
export const APPLE_ISSUER = 'https://appleid.apple.com';
const SKEW_SECONDS = 60;

export type OidcKeys = () => Promise<JsonWebKey[]>;
export type OidcCheck =
  | { ok: true; email: string; subject: string; privateRelay: boolean }
  | { ok: false; reason: 'format' | 'signature' | 'issuer' | 'audience' | 'expired' | 'email_unverified' | 'keys_unavailable' };

export interface OidcExpectation {
  issuers: readonly string[];
  /** Our client ids for this provider. A token for any other app is refused. */
  audiences: readonly string[];
}

/** A provider's signing keys, fetched when needed and kept for as long as its Cache-Control allows (at most a day). */
export function oidcKeysFromNetwork(url: string, fetchImpl: typeof fetch = fetch): OidcKeys {
  let cached: { keys: JsonWebKey[]; until: number } | null = null;
  return async () => {
    if (cached && cached.until > Date.now()) return cached.keys;
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Key endpoint answered ${response.status}`);
    const body = (await response.json()) as { keys?: JsonWebKey[] };
    if (!Array.isArray(body.keys)) throw new Error('Key endpoint is malformed');
    const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1] ?? 3600);
    cached = { keys: body.keys, until: Date.now() + Math.min(maxAge, 86_400) * 1000 };
    return body.keys;
  };
}

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;

export async function verifyOidcIdToken(token: string, expect: OidcExpectation, keys: OidcKeys, nowMs: number): Promise<OidcCheck> {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'format' };
  let header: Record<string, unknown>, claims: Record<string, unknown>;
  try { header = decode(parts[0]); claims = decode(parts[1]); } catch { return { ok: false, reason: 'format' }; }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return { ok: false, reason: 'format' };

  let jwks: JsonWebKey[];
  try { jwks = await keys(); } catch { return { ok: false, reason: 'keys_unavailable' }; }
  const jwk = jwks.find((k) => (k as { kid?: string }).kid === header.kid && k.kty === 'RSA');
  if (!jwk) return { ok: false, reason: 'signature' };
  let valid = false;
  try {
    const key = crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: 'jwk' });
    valid = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
  } catch { valid = false; }
  if (!valid) return { ok: false, reason: 'signature' };

  if (typeof claims.iss !== 'string' || !expect.issuers.includes(claims.iss)) return { ok: false, reason: 'issuer' };
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (expect.audiences.length === 0 || !audience.some((a) => typeof a === 'string' && expect.audiences.includes(a))) return { ok: false, reason: 'audience' };
  const now = Math.floor(nowMs / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + SKEW_SECONDS <= now) return { ok: false, reason: 'expired' };
  if (typeof claims.iat === 'number' && claims.iat - SKEW_SECONDS > now) return { ok: false, reason: 'expired' };
  // Apple sends email_verified as the string "true"; Google as a boolean.
  const verified = claims.email_verified === true || claims.email_verified === 'true';
  if (!verified || typeof claims.email !== 'string' || !claims.email.includes('@')) return { ok: false, reason: 'email_unverified' };
  const privateRelay = claims.is_private_email === true || claims.is_private_email === 'true';
  return { ok: true, email: claims.email.trim().toLowerCase(), subject: String(claims.sub ?? ''), privateRelay };
}

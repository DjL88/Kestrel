import crypto from 'node:crypto';

/**
 * Checks a Google Identity Services ID token (what "Sign in with Google" hands the admin page) on the server.
 * Only an RS256 token signed by one of Google's current keys, issued by Google, for this site's OAuth client, unexpired,
 * with a verified email, passes. The caller decides whether that email may do anything.
 */

export const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
/** Allowed clock difference between Google and this server. */
const SKEW_SECONDS = 60;

export type GoogleKeys = () => Promise<JsonWebKey[]>;
export type GoogleCheck = { ok: true; email: string; subject: string } | { ok: false; reason: 'format' | 'signature' | 'issuer' | 'audience' | 'expired' | 'email_unverified' | 'keys_unavailable' };

/** Google's signing keys, fetched when needed and kept for as long as Google's Cache-Control allows (at most a day). */
export function googleKeysFromNetwork(fetchImpl: typeof fetch = fetch): GoogleKeys {
  let cached: { keys: JsonWebKey[]; until: number } | null = null;
  return async () => {
    if (cached && cached.until > Date.now()) return cached.keys;
    const response = await fetchImpl(GOOGLE_CERTS_URL, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Google keys answered ${response.status}`);
    const body = (await response.json()) as { keys?: JsonWebKey[] };
    if (!Array.isArray(body.keys)) throw new Error('Google keys are malformed');
    const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1] ?? 3600);
    cached = { keys: body.keys, until: Date.now() + Math.min(maxAge, 86_400) * 1000 };
    return body.keys;
  };
}

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;

export async function verifyGoogleIdToken(token: string, clientId: string, keys: GoogleKeys, nowMs: number): Promise<GoogleCheck> {
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

  if (typeof claims.iss !== 'string' || !ISSUERS.has(claims.iss)) return { ok: false, reason: 'issuer' };
  if (claims.aud !== clientId) return { ok: false, reason: 'audience' };
  const now = Math.floor(nowMs / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + SKEW_SECONDS <= now) return { ok: false, reason: 'expired' };
  if (typeof claims.iat === 'number' && claims.iat - SKEW_SECONDS > now) return { ok: false, reason: 'expired' };
  if (claims.email_verified !== true || typeof claims.email !== 'string') return { ok: false, reason: 'email_unverified' };
  return { ok: true, email: claims.email.trim().toLowerCase(), subject: String(claims.sub ?? '') };
}

import crypto, { type KeyObject } from 'node:crypto';
import { canonicalJson, type SignedEnvelope } from '../../../src/core/signedEnvelope.ts';

export const sha256Hex = (data: string | Buffer) => crypto.createHash('sha256').update(data).digest('hex');
export const randomId = (bytes = 16) => crypto.randomBytes(bytes).toString('base64url');
export const uuid = () => crypto.randomUUID();

const b64url = (data: Buffer | string) => Buffer.from(data).toString('base64url');

// ---- Session tokens (HS256 JWT, 15 minutes) --------------------------------

export interface SessionClaims { sub: string; role: 'user' | 'admin'; iat: number; exp: number; jti: string }
export type TokenCheck = { ok: true; claims: SessionClaims } | { ok: false; code: 'AUTH_TOKEN_EXPIRED' | 'AUTH_TOKEN_INVALID' };

export function signSession(sub: string, role: SessionClaims['role'], secret: Buffer, nowMs: number, ttlSeconds = 900): string {
  const iat = Math.floor(nowMs / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ sub, role, iat, exp: iat + ttlSeconds, jti: randomId(9) } satisfies SessionClaims));
  const mac = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${mac}`;
}

export function verifySession(token: string, secret: Buffer, nowMs: number): TokenCheck {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, code: 'AUTH_TOKEN_INVALID' };
  const expected = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  const given = Buffer.from(parts[2], 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return { ok: false, code: 'AUTH_TOKEN_INVALID' };
  let header: unknown, claims: unknown;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch { return { ok: false, code: 'AUTH_TOKEN_INVALID' }; }
  const h = header as Record<string, unknown>, c = claims as Record<string, unknown>;
  if (h?.alg !== 'HS256' || typeof c?.sub !== 'string' || (c.role !== 'user' && c.role !== 'admin') ||
      !Number.isSafeInteger(c.exp) || !Number.isSafeInteger(c.iat) || typeof c.jti !== 'string') {
    return { ok: false, code: 'AUTH_TOKEN_INVALID' };
  }
  if ((c.exp as number) * 1000 <= nowMs) return { ok: false, code: 'AUTH_TOKEN_EXPIRED' };
  return { ok: true, claims: c as unknown as SessionClaims };
}

// ---- Ed25519 envelopes (grants, manifests) ----------------------------------

export interface SigningKey { keyId: string; privateKey: KeyObject; publicKeyBase64: string }

/** Load an Ed25519 key from PKCS#8 PEM, or create a throwaway one for local development and tests. */
export function loadSigningKey(keyId: string, pem?: string): SigningKey {
  const privateKey = pem ? crypto.createPrivateKey(pem) : crypto.generateKeyPairSync('ed25519').privateKey;
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Signing key must be Ed25519');
  const jwk = crypto.createPublicKey(privateKey).export({ format: 'jwk' }) as { x: string };
  return { keyId, privateKey, publicKeyBase64: Buffer.from(jwk.x, 'base64url').toString('base64') };
}

export function signEnvelope<T>(payload: T, key: SigningKey): SignedEnvelope<T> {
  const signature = crypto.sign(null, Buffer.from(canonicalJson(payload), 'utf8'), key.privateKey);
  return { payload, signature: signature.toString('base64'), keyId: key.keyId };
}

// ---- Billing webhooks (HMAC-SHA256, Stripe-style "t=..,v1=..") ---------------

export function signWebhook(body: string, secret: string, timestampSeconds: number): string {
  const v1 = crypto.createHmac('sha256', secret).update(`${timestampSeconds}.${body}`).digest('hex');
  return `t=${timestampSeconds},v1=${v1}`;
}

export function verifyWebhook(body: string, header: string | undefined, secret: string, nowMs: number, windowSeconds = 300): boolean {
  if (!header || !secret) return false;
  const fields = new Map(header.split(',').map((part) => part.split('=', 2) as [string, string]));
  const t = Number(fields.get('t')), v1 = fields.get('v1');
  if (!Number.isSafeInteger(t) || !v1 || !/^[0-9a-f]{64}$/.test(v1)) return false;
  if (Math.abs(nowMs / 1000 - t) > windowSeconds) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest();
  return crypto.timingSafeEqual(Buffer.from(v1, 'hex'), expected);
}

// ---- Passwords (scrypt) ------------------------------------------------------

const SCRYPT = { N: 16384, r: 8, p: 1 } as const;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(actual, expected);
}

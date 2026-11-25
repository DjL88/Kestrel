import { z } from 'zod';
import { metadataAccessToken } from '../gcsAdapters.ts';
import { paddleApiBase, type PaddleEnvironment } from './paddle.ts';

/**
 * Keeps the Paddle API key alive without anyone copying keys by hand.
 *
 * Paddle API keys expire (90 days by default). A key created as "Rotatable" can ask Paddle for a new secret for itself
 * (POST /api-keys/{id}/rotations, no extra permission). A weekly job (runPaddleKeyRotation.ts) does that once the key
 * is 60 days old: it creates the rotation with a fresh expiry, saves the new secret as a new version of the Secret
 * Manager secret, then makes one call with it, which activates it. From then the old secret works for one more hour, so
 * running servers (which re-read the secret every few minutes) move over without a redeploy or a failed request.
 *
 * Any failure leaves the old secret working: a rotation is only activated by its first use, and a newer rotation
 * cancels a pending one. The job then fails loudly and tries again next week, weeks before the key would expire.
 */

/** pdl_live_apikey_<26>_<secret> or pdl_sdbx_apikey_<26>_<secret>; the key's ID is apikey_<26>. */
const PADDLE_KEY = /^pdl_(live|sdbx)_apikey_([a-z0-9]{26})_[A-Za-z0-9_]+$/;

export function paddleKeyId(secret: string): string {
  const match = PADDLE_KEY.exec(secret);
  if (!match) throw new Error('This is not a Paddle API key.');
  return 'apikey_' + match[2];
}

const keyEnvironment = (secret: string): PaddleEnvironment => (secret.startsWith('pdl_sdbx_') ? 'sandbox' : 'production');

/** One Secret Manager secret, read and written as its own service account (REST, metadata-server token). */
export function secretManagerSecret(options: { project: string; secret: string; request?: typeof fetch; token?: () => Promise<string> }) {
  if (!/^[a-z][a-z0-9-]{4,29}$/.test(options.project) || !/^[A-Za-z0-9_-]{1,255}$/.test(options.secret)) {
    throw new Error('Invalid Secret Manager project or secret name.');
  }
  const request = options.request ?? fetch;
  const token = options.token ?? (() => metadataAccessToken(request));
  const base = `https://secretmanager.googleapis.com/v1/projects/${options.project}/secrets/${options.secret}`;
  async function call(path: string, init?: RequestInit) {
    const response = await request(base + path, {
      ...init,
      headers: { Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    // The body could hold a secret; never pass it on.
    if (!response.ok) throw new Error('Secret Manager request failed with ' + response.status + '.');
    return response.json() as Promise<Record<string, unknown>>;
  }
  return {
    async latest(): Promise<string> {
      const body = await call('/versions/latest:access');
      const data = (body.payload as { data?: unknown } | undefined)?.data;
      if (typeof data !== 'string') throw new Error('Secret Manager returned no secret.');
      return Buffer.from(data, 'base64').toString('utf8').trim();
    },
    async add(value: string): Promise<void> {
      await call(':addVersion', { method: 'POST', body: JSON.stringify({ payload: { data: Buffer.from(value, 'utf8').toString('base64') } }) });
    },
  };
}

/**
 * The key the server uses for each Paddle call: re-read from Secret Manager at most every `ttlMs`, so a rotated key
 * takes over without a redeploy. If Secret Manager cannot be reached it keeps the last good key (or the start-up value
 * Cloud Run injected), because a stale key still works for the hour-long grace period and usually for weeks.
 */
export function rotatingKeySource(read: () => Promise<string>, fallback: string | undefined, ttlMs = 5 * 60_000, now: () => number = Date.now) {
  let current = fallback;
  let fetchedAt = -Infinity;
  let inFlight: Promise<string> | null = null;
  return async (): Promise<string> => {
    if (current && now() - fetchedAt < ttlMs) return current;
    inFlight ??= read().then((value) => {
      paddleKeyId(value);
      current = value;
      fetchedAt = now();
      return value;
    }).catch((error) => {
      fetchedAt = now(); // do not hammer Secret Manager while it is down
      if (current) return current;
      throw error;
    }).finally(() => { inFlight = null; });
    return inFlight;
  };
}

export interface RotationState {
  keyId: string;
  rotationId: string;
  rotatedAt: string;
  expiresAt: string;
  activated: boolean;
}

export interface RotationStore {
  get(): Promise<RotationState | null>;
  set(state: RotationState): Promise<void>;
}

const rotation = z.object({
  id: z.string().regex(/^apkrot_[a-z0-9]{26}$/),
  api_key_id: z.string(),
  new_key: z.string(),
  status: z.string(),
});

const DAY_MS = 86_400_000;

export async function rotatePaddleKeyIfDue(deps: {
  secret: { latest(): Promise<string>; add(value: string): Promise<void> };
  store: RotationStore;
  request?: typeof fetch;
  now?: () => number;
  /** Rotate once the key was last rotated this long ago (or never by us). */
  rotateAfterDays?: number;
  /** Lifetime given to each new secret. */
  lifetimeDays?: number;
  /** How long the previous secret keeps working once the new one is in use. Paddle allows 0 to 86,400. */
  graceSeconds?: number;
}): Promise<{ rotated: false; nextDueAt: string } | { rotated: true; expiresAt: string; activated: boolean }> {
  const request = deps.request ?? fetch;
  const now = deps.now ?? Date.now;
  const rotateAfterDays = deps.rotateAfterDays ?? 60;
  const lifetimeDays = deps.lifetimeDays ?? 90;
  const graceSeconds = deps.graceSeconds ?? 3600;
  if (!(rotateAfterDays > 0 && rotateAfterDays < lifetimeDays)) throw new Error('Rotate well before the key expires.');

  const key = await deps.secret.latest();
  const keyId = paddleKeyId(key);
  const base = paddleApiBase(keyEnvironment(key));
  const state = await deps.store.get();
  // A key we have not rotated before (or a replaced key) is rotated on the first run, which also sets a known expiry.
  if (state && state.keyId === keyId && now() - Date.parse(state.rotatedAt) < rotateAfterDays * DAY_MS) {
    return { rotated: false, nextDueAt: new Date(Date.parse(state.rotatedAt) + rotateAfterDays * DAY_MS).toISOString() };
  }

  const expiresAt = new Date(now() + lifetimeDays * DAY_MS).toISOString();
  const created = await request(`${base}/api-keys/${keyId}/rotations`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Paddle-Version': '1' },
    body: JSON.stringify({ grace_period_seconds: graceSeconds, new_key_expires_at: expiresAt }),
    signal: AbortSignal.timeout(10_000),
  });
  if (created.status === 403 || created.status === 400) {
    throw new Error(`Paddle refused to rotate the key (${created.status}). It must be created with "Rotatable" ticked; make a new rotatable key and save it as a new secret version.`);
  }
  if (!created.ok) throw new Error('Paddle rotation request failed with ' + created.status + '.');
  const made = rotation.parse(((await created.json()) as { data?: unknown }).data);
  if (made.api_key_id !== keyId || paddleKeyId(made.new_key) !== keyId) throw new Error('Paddle returned a rotation for a different key.');

  // Save before activating: until the new secret is used, the old one keeps working.
  await deps.secret.add(made.new_key);

  // The first request with the new secret activates it and starts the old one's grace period.
  let activated = false;
  try {
    const check = await request(`${base}/api-keys/${keyId}/rotations/${made.id}`, {
      headers: { Authorization: 'Bearer ' + made.new_key, 'Paddle-Version': '1' },
      signal: AbortSignal.timeout(10_000),
    });
    activated = check.ok;
  } catch { /* the servers' next Paddle call activates it instead */ }

  await deps.store.set({ keyId, rotationId: made.id, rotatedAt: new Date(now()).toISOString(), expiresAt, activated });
  return { rotated: true, expiresAt, activated };
}

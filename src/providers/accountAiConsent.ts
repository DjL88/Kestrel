import { parseControlPlaneUrl } from '../core/licenceOnline';

/**
 * Account-level consent for the *optional* managed Gemini helper.
 *
 * Firebase is used only to exchange the current person's ID token for a
 * short-lived control-plane session. The session stays in this function:
 * no persistent token, cookie, cache, background upload or photo is involved.
 * Read the live server setting; never guess "on" from a stored local switch.
 */
export interface ManagedAiConsentStatus {
  consent: boolean;
  planAvailable: boolean;
}

export type AccountCloudUsage =
  | { state: 'unavailable' }
  | { state: 'available'; bytesUsed: number; bytesQuota: number };

export class AccountAiConsentError extends Error {
  constructor(message = 'Could not reach your online AI settings. Nothing has changed.') {
    super(message);
    this.name = 'AccountAiConsentError';
  }
}

type JsonObject = Record<string, unknown>;
const record = (value: unknown): JsonObject | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject : null;

/** All calls have a short deadline and never forward cookies or page referrers. */
async function request(
  url: string, fetcher: typeof fetch, method: 'GET' | 'POST',
  body?: JsonObject, token?: string,
): Promise<JsonObject> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetcher(url, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: 'Bearer ' + token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    const parsed = record(await response.json().catch(() => null));
    if (!response.ok || !parsed) throw new AccountAiConsentError();
    return parsed;
  } catch {
    throw new AccountAiConsentError();
  } finally {
    clearTimeout(timer);
  }
}

async function withSession<T>(
  baseUrl: string | null, firebaseIdToken: string | null,
  fetcher: typeof fetch, action: (origin: string, session: string) => Promise<T>,
): Promise<T> {
  // Revalidate the exact public endpoint even if the caller already parsed it.
  const origin = parseControlPlaneUrl(baseUrl ?? undefined);
  if (!origin) throw new AccountAiConsentError('Online AI settings are not configured in this build.');
  if (!firebaseIdToken?.trim()) throw new AccountAiConsentError('Sign in again to manage online AI.');
  const signedIn = await request(origin + '/v1/auth/firebase', fetcher, 'POST', { credential: firebaseIdToken });
  const session = signedIn.accessToken;
  if (typeof session !== 'string' || !session || session.length > 8192) throw new AccountAiConsentError();
  // Never store or return the control-plane bearer token.
  return action(origin, session);
}

export function readAccountAiConsent(
  baseUrl: string | null, firebaseIdToken: string | null,
  fetcher: typeof fetch = fetch,
): Promise<ManagedAiConsentStatus> {
  return withSession(baseUrl, firebaseIdToken, fetcher, async (origin, session) => {
    const data = await request(origin + '/v1/me/entitlements', fetcher, 'GET', undefined, session);
    return consentFrom(data);
  });
}

function consentFrom(data: JsonObject): ManagedAiConsentStatus {
  if (typeof data.aiConsent !== 'boolean') throw new AccountAiConsentError();
  const plans = Array.isArray(data.plans) ? data.plans : [];
  const planAvailable = plans.some(plan => {
    const value = record(plan);
    return value?.managedAi === true && value?.status === 'active';
  });
  return { consent: data.aiConsent, planAvailable };
}

/** Only show the account's server-reported storage usage after sign-in. An unconfigured
 * service is treated as unavailable, never as an empty or full allowance. */
export function readAccountOnlineSettings(
  baseUrl: string | null, firebaseIdToken: string | null, fetcher: typeof fetch = fetch,
): Promise<{ ai: ManagedAiConsentStatus; cloud: AccountCloudUsage | null }> {
  return withSession(baseUrl, firebaseIdToken, fetcher, async (origin, session) => {
    const data = await request(origin + '/v1/me/entitlements', fetcher, 'GET', undefined, session);
    const ai = consentFrom(data);
    const cloudPlan = Array.isArray(data.plans) && data.plans.some(plan => {
      const value = record(plan);
      return value?.plan === 'subscriber' && value.status === 'active';
    });
    if (!cloudPlan) return { ai, cloud: null };
    const usage = await request(origin + '/v1/safe-copy/usage', fetcher, 'GET', undefined, session).catch(() => null);
    const used = usage?.bytesUsed;
    const quota = usage?.bytesQuota;
    const valid = typeof used === 'number' && Number.isSafeInteger(used) && used >= 0
      && typeof quota === 'number' && Number.isSafeInteger(quota) && quota > 0;
    return { ai, cloud: valid ? { state: 'available', bytesUsed: used, bytesQuota: quota } : { state: 'unavailable' } };
  });
}

/** Only call following an explicit settings change, never from render/effects. */
export function setAccountAiConsent(
  baseUrl: string | null, firebaseIdToken: string | null,
  consent: boolean, fetcher: typeof fetch = fetch,
): Promise<boolean> {
  if (typeof consent !== 'boolean') return Promise.reject(new AccountAiConsentError());
  return withSession(baseUrl, firebaseIdToken, fetcher, async (origin, session) => {
    const data = await request(origin + '/v1/me/ai-consent', fetcher, 'POST', { consent }, session);
    // Do not display success if an older/unexpected server did not confirm it.
    if (data.aiConsent !== consent) throw new AccountAiConsentError();
    return consent;
  });
}

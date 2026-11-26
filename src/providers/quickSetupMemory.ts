import { parseControlPlaneUrl } from '../core/licenceOnline';
import { accountCopy, parseSetupAnswers, reconcileSetup, type SetupAnswers } from '../core/quickSetup';

/**
 * Where the quick setup answers are kept: on this device (localStorage) and, once signed in, on the account
 * (`/v1/me/preferences` on the control plane, which keeps them in Firestore beside the account). Only the answers:
 * language, what they shoot, experience, the cloud choice, Flight mode and whether setup is finished. Never photos.
 */
export const SETUP_KEY = 'inflight.setup';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const local = (): Store | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };

export function readSetup(store: Store | null = local()): SetupAnswers | null {
  try { return parseSetupAnswers(JSON.parse(store?.getItem(SETUP_KEY) ?? 'null')); } catch { return null; }
}

export function writeSetup(answers: SetupAnswers, store: Store | null = local()): void {
  try { store?.setItem(SETUP_KEY, JSON.stringify(answers)); } catch { /* lasts for this visit */ }
}

/** Settings → Run setup again: starts at the first step next time it is shown, keeping the earlier answers. */
export function restartSetup(store: Store | null = local()): SetupAnswers {
  const next: SetupAnswers = { ...(readSetup(store) ?? {}), status: 'in-progress', step: 'language' };
  writeSetup(next, store);
  return next;
}

const env = (import.meta as { env?: Record<string, string | undefined> }).env;

async function call(url: string, fetcher: typeof fetch, method: 'GET' | 'POST', body?: unknown, token?: string): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetcher(url, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
    });
    const json = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || !json || typeof json !== 'object') throw new Error('preferences unavailable');
    return json;
  } finally {
    clearTimeout(timer);
  }
}

export interface AccountSetupDeps {
  baseUrl?: string | null;
  idToken?: () => Promise<string | null>;
  fetcher?: typeof fetch;
}

async function session(deps: AccountSetupDeps): Promise<{ origin: string; token: string } | null> {
  const origin = parseControlPlaneUrl((deps.baseUrl ?? env?.VITE_KESTREL_CONTROL_PLANE_URL) || undefined);
  if (!origin) return null;
  const idToken = deps.idToken ?? (async () => (await import('./firebaseAuth')).firebaseAuth.idToken().catch(() => null));
  const credential = await idToken();
  if (!credential) return null;
  const signedIn = await call(origin + '/v1/auth/firebase', deps.fetcher ?? fetch, 'POST', { credential });
  const token = signedIn.accessToken;
  return typeof token === 'string' && token && token.length <= 8192 ? { origin, token } : null;
}

/** Saves the answers to the signed-in account. Quiet when signed out or offline: this device keeps them either way. */
export async function saveSetupToAccount(answers: SetupAnswers, deps: AccountSetupDeps = {}): Promise<boolean> {
  try {
    const s = await session(deps);
    if (!s) return false;
    await call(s.origin + '/v1/me/preferences', deps.fetcher ?? fetch, 'POST', { setup: accountCopy(answers) }, s.token);
    return true;
  } catch {
    return false;
  }
}

/**
 * After signing in: compares this device's answers with the account's. The account's finished answers are applied
 * here (returned, so the caller can switch the language and settings, and setup is not shown again); this device's
 * finished answers are saved to the account. Null when the account was checked and has nothing to apply; undefined
 * when it could not be checked (signed out, offline, not set up in this build), so setup is not offered on a guess.
 */
export async function syncSetupWithAccount(deps: AccountSetupDeps = {}, store: Store | null = local()): Promise<SetupAnswers | null | undefined> {
  try {
    const s = await session(deps);
    if (!s) return undefined;
    const fetcher = deps.fetcher ?? fetch;
    const reply = await call(s.origin + '/v1/me/preferences', fetcher, 'GET', undefined, s.token);
    const account = parseSetupAnswers((reply.preferences as Record<string, unknown> | null | undefined)?.setup);
    const device = readSetup(store);
    const which = reconcileSetup(device, account);
    if (which === 'account' && account) {
      writeSetup({ ...account, step: undefined }, store);
      return account;
    }
    if (which === 'device' && device) await call(s.origin + '/v1/me/preferences', fetcher, 'POST', { setup: accountCopy(device) }, s.token);
    return null;
  } catch {
    return undefined;
  }
}

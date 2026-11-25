import { parseControlPlaneUrl } from '../core/licenceOnline';

/**
 * The app's side of merging two accounts (services/control-plane/src/accountMerge.ts). The other account's sign-in
 * proves it agrees (a 15-minute ticket); the signed-in account previews, confirms and can undo for 30 days.
 */
export interface MergePreview { mergeId: string; licences: number; balanceMillicredits: number; projects: number; pushDevices: number; blocked: null | 'same-account' | 'not-active' | 'safe-copy' }
export interface MergeSummary { mergeId: string; status: 'moving' | 'done' | 'undoing' | 'undone'; createdAtMs: number; undoUntilMs: number; licences: number; balanceMillicredits: number; projects: number }

export class MergeError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'MergeError'; }
}

type Json = Record<string, unknown>;

export function accountMergeClient(baseUrl: string | undefined | null, idToken: () => Promise<string | null>, fetcher: typeof fetch = (...args) => fetch(...args)) {
  const origin = parseControlPlaneUrl(baseUrl ?? undefined);
  async function post(path: string, body: Json | undefined, bearer?: string, method: 'GET' | 'POST' = 'POST'): Promise<Json> {
    if (!origin) throw new MergeError('NOT_CONFIGURED', 'Merging accounts is not available in this version yet.');
    let response: Response;
    try {
      response = await fetcher(origin + path, {
        method, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15_000),
        headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(bearer ? { authorization: 'Bearer ' + bearer } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch { throw new MergeError('NETWORK', 'Could not reach InFlight. Nothing was changed.'); }
    const json = await response.json().catch(() => null) as Json | null;
    if (!response.ok) {
      const error = (json?.error ?? {}) as { code?: string; message?: string };
      throw new MergeError(error.code ?? 'REFUSED', error.message ?? 'The merge did not go ahead. Nothing was changed.');
    }
    return json ?? {};
  }
  async function session(token: string | null): Promise<string> {
    if (!token) throw new MergeError('SIGN_IN', 'Sign in first.');
    const signed = await post('/v1/auth/firebase', { credential: token });
    if (typeof signed.accessToken !== 'string') throw new MergeError('SIGN_IN', 'Sign in first.');
    return signed.accessToken;
  }
  const mine = async () => session(await idToken().catch(() => null));
  return {
    configured: origin !== null,
    /** Signed in to the other account (its ID token): a ticket saying it agrees to be merged into this one. */
    async ticket(otherIdToken: string): Promise<string> {
      const r = await post('/v1/me/merge/ticket', {}, await session(otherIdToken));
      if (typeof r.ticket !== 'string') throw new MergeError('REFUSED', 'The other account could not be checked. Nothing was changed.');
      return r.ticket;
    },
    preview: async (ticket: string) => (await post('/v1/me/merge/preview', { ticket }, await mine())) as unknown as MergePreview,
    merge: async (ticket: string) => (await post('/v1/me/merge', { ticket }, await mine())) as unknown as { mergeId: string; undoUntilMs: number },
    list: async () => ((await post('/v1/me/merges', undefined, await mine(), 'GET')).merges ?? []) as MergeSummary[],
    undo: async (mergeId: string) => { await post('/v1/me/merge/undo', { mergeId }, await mine()); },
  };
}
export type AccountMergeClient = ReturnType<typeof accountMergeClient>;

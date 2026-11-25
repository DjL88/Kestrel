import { zipSync, strToU8 } from 'fflate';
import { parseControlPlaneUrl } from '../core/licenceOnline';
import { accountDataFiles } from '../core/accountDataArchive';

/**
 * The app's side of "Download my data" and "Delete my account" (services/control-plane/src/accountErasure.ts).
 * Only the online account is involved: projects, edits and original photos on this device are never read or changed.
 */
export interface DeletionPreview {
  ownedSharedProjects: number; peopleInOwnedProjects: number; otherSharedProjects: number;
  cloudPhotos: number; licences: number; balanceMillicredits: number; blocked: null | 'safe-copy';
}
export interface DeletionState { status: 'scheduled' | 'deleting'; requestedAtMs: number; deleteAfterMs: number }

export class AccountDataError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'AccountDataError'; }
}

type Json = Record<string, unknown>;

export interface AccountDataClient {
  configured: boolean;
  deletion(): Promise<{ deletion: DeletionState | null; preview: DeletionPreview }>;
  /** The export as zip bytes (README, JSON and CSV files). */
  download(readme: string): Promise<Blob>;
  scheduleDeletion(confirm: string): Promise<DeletionState>;
  cancelDeletion(): Promise<void>;
}

export function accountDataClient(baseUrl: string | undefined | null, idToken: () => Promise<string | null>, fetcher: typeof fetch = (...args) => fetch(...args)): AccountDataClient {
  const origin = parseControlPlaneUrl(baseUrl ?? undefined);
  async function call(path: string, method: 'GET' | 'POST', body?: Json, bearer?: string): Promise<Json> {
    if (!origin) throw new AccountDataError('NOT_CONFIGURED', 'This is not available in this version yet.');
    let response: Response;
    try {
      response = await fetcher(origin + path, {
        method, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30_000),
        headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(bearer ? { authorization: 'Bearer ' + bearer } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch { throw new AccountDataError('NETWORK', 'Could not reach InFlight. Nothing was changed.'); }
    const json = await response.json().catch(() => null) as Json | null;
    if (!response.ok) {
      const error = (json?.error ?? {}) as { code?: string; message?: string };
      throw new AccountDataError(error.code ?? 'REFUSED', error.message ?? 'That did not work. Nothing was changed.');
    }
    return json ?? {};
  }
  async function session(): Promise<string> {
    const token = await idToken().catch(() => null);
    if (!token) throw new AccountDataError('SIGN_IN', 'Sign in first.');
    const signed = await call('/v1/auth/firebase', 'POST', { credential: token });
    if (typeof signed.accessToken !== 'string') throw new AccountDataError('SIGN_IN', 'Sign in first.');
    return signed.accessToken;
  }
  return {
    configured: origin !== null,
    deletion: async () => (await call('/v1/me/deletion', 'GET', undefined, await session())) as unknown as { deletion: DeletionState | null; preview: DeletionPreview },
    async download(readme) {
      const exported = await call('/v1/me/data-export', 'GET', undefined, await session());
      const files = accountDataFiles(exported, readme);
      const zip = zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])));
      return new Blob([zip as BlobPart], { type: 'application/zip' });
    },
    async scheduleDeletion(confirm) {
      const r = await call('/v1/me/deletion', 'POST', { confirm }, await session());
      if (!r.deletion) throw new AccountDataError('REFUSED', 'That did not work. Nothing was changed.');
      return r.deletion as DeletionState;
    },
    async cancelDeletion() { await call('/v1/me/deletion/cancel', 'POST', undefined, await session()); },
  };
}

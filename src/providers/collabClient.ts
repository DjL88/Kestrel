import { parseControlPlaneUrl } from '../core/licenceOnline';
import type { CollabRole } from '../core/collabRoles';

/**
 * The app's side of shared projects (#1387): talks to the control plane's /v1/collab routes. Sharing is opt-in and
 * needs a signed-in account; a project that is never shared never calls this. The control-plane session is exchanged
 * from the Firebase ID token for each action and never stored.
 */
export type CollabErrorKind = 'not-configured' | 'sign-in' | 'not-entitled' | 'switched-off' | 'not-permitted' | 'refused' | 'network';

export class CollabError extends Error {
  constructor(readonly kind: CollabErrorKind, readonly code = '', message = 'Could not reach sharing.') { super(message); this.name = 'CollabError'; }
}

export interface CollabMemberView { accountId: string; role: CollabRole; displayName: string; photoIds?: string[] }
export interface CollabProjectView {
  projectId: string;
  name: string;
  me: CollabMemberView;
  members: CollabMemberView[];
  invites: { role: CollabRole; displayName: string; photoIds?: string[] }[];
}
export interface CollabInvite { projectId: string; name: string; role: CollabRole }

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value);

function kindFor(status: number, code: string): CollabErrorKind {
  if (code === 'COLLAB_NOT_CONFIGURED' || code === 'PRESENCE_NOT_CONFIGURED') return 'not-configured';
  if (code === 'COLLAB_NOT_ENTITLED') return 'not-entitled';
  if (code === 'COLLAB_DISABLED') return 'switched-off';
  if (status === 401) return 'sign-in';
  if (status === 403) return 'not-permitted';
  return 'refused';
}

async function request(url: string, fetcher: typeof fetch, method: 'GET' | 'POST', body?: Json, token?: string): Promise<Json> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  let response: Response;
  try {
    response = await fetcher(url, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new CollabError('network');
  } finally {
    clearTimeout(timer);
  }
  const parsed = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : {};
    const code = typeof error.code === 'string' ? error.code : '';
    throw new CollabError(kindFor(response.status, code), code, typeof error.message === 'string' ? error.message : undefined);
  }
  if (!isRecord(parsed)) throw new CollabError('network');
  return parsed;
}

export interface CollabClient {
  configured: boolean;
  myProjects(): Promise<{ projectId: string; name: string; role: CollabRole }[]>;
  invites(): Promise<CollabInvite[]>;
  create(name: string, displayName: string): Promise<string>;
  project(projectId: string): Promise<CollabProjectView>;
  invite(projectId: string, email: string, role: Exclude<CollabRole, 'owner'>, photoIds?: string[]): Promise<CollabProjectView>;
  remove(projectId: string, accountId: string): Promise<CollabProjectView>;
  accept(projectId: string, displayName: string): Promise<void>;
  presenceToken(projectId: string): Promise<{ customToken: string; databaseUrl: string; uid: string; expiresAtMs: number }>;
}

/** `idToken` returns the signed-in person's Firebase ID token, or null when signed out. */
export function collabClient(baseUrl: string | undefined | null, idToken: () => Promise<string | null>, fetcher: typeof fetch = (...args) => fetch(...args)): CollabClient {
  const origin = parseControlPlaneUrl(baseUrl ?? undefined);
  async function call(method: 'GET' | 'POST', path: string, body?: Json): Promise<Json> {
    if (!origin) throw new CollabError('not-configured');
    const credential = await idToken().catch(() => null);
    if (!credential?.trim()) throw new CollabError('sign-in');
    const signedIn = await request(origin + '/v1/auth/firebase', fetcher, 'POST', { credential });
    const session = signedIn.accessToken;
    if (typeof session !== 'string' || !session || session.length > 8192) throw new CollabError('sign-in');
    return request(origin + path, fetcher, method, body, session);
  }
  const P = (id: string) => `/v1/collab/projects/${encodeURIComponent(id)}`;
  const asProject = (data: Json) => data as unknown as CollabProjectView;
  return {
    configured: origin !== null,
    myProjects: async () => ((await call('GET', '/v1/collab/projects')).projects ?? []) as { projectId: string; name: string; role: CollabRole }[],
    invites: async () => ((await call('GET', '/v1/collab/invites')).invites ?? []) as CollabInvite[],
    create: async (name, displayName) => String((await call('POST', '/v1/collab/projects', { name, displayName })).projectId),
    project: async (id) => asProject(await call('GET', P(id))),
    invite: async (id, email, role, photoIds) => asProject(await call('POST', P(id) + '/members', { kind: 'inviteEmail', email, role, ...(photoIds ? { photoIds } : {}) })),
    remove: async (id, accountId) => asProject(await call('POST', P(id) + '/members', { kind: 'remove', accountId })),
    accept: async (id, displayName) => { await call('POST', P(id) + '/accept', { displayName }); },
    presenceToken: async (id) => (await call('POST', P(id) + '/presence-token')) as unknown as { customToken: string; databaseUrl: string; uid: string; expiresAtMs: number },
  };
}

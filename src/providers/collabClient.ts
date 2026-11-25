import { parseControlPlaneUrl } from '../core/licenceOnline';
import type { CollabRole } from '../core/collabRoles';
import type { GalleryFeedbackEvent } from '../core/galleryFeedback';

/**
 * The app's side of shared projects (#1387): talks to the control plane's /v1/collab routes. Sharing is opt-in and
 * needs a signed-in account; a project that is never shared never calls this. The control-plane session is exchanged
 * from the Firebase ID token for each action and never stored.
 */
export type CollabErrorKind = 'not-configured' | 'sign-in' | 'not-entitled' | 'switched-off' | 'not-permitted' | 'refused' | 'network';

export class CollabError extends Error {
  constructor(readonly kind: CollabErrorKind, readonly code = '', message = 'Could not reach sharing.', readonly detail: Record<string, unknown> = {}) { super(message); this.name = 'CollabError'; }
}

export interface CollabMemberView { accountId: string; role: CollabRole; displayName: string; photoIds?: string[] }
export interface CollabProjectView {
  projectId: string;
  name: string;
  me: CollabMemberView;
  members: CollabMemberView[];
  invites: { role: CollabRole; displayName: string; photoIds?: string[] }[];
}
export interface GalleryRequest {
  name: string; photoIds: string[]; days: number; password?: string;
  allowComments: boolean; allowFavourites: boolean; allowApproval: boolean; allowDownloads: boolean; watermark: boolean;
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface GalleryListItem { galleryId: string; name: string; expiresAtMs: number; photos: number; photoIds: string[]; published: number; password: boolean }

export interface SharedLeaseView { photoId: string; holder: string | null; mine: boolean }
export interface SharedRevisionMeta { id: string; number: number; parentId: string | null; authorAccountId: string; createdAtMs: number; virtualCopyOf?: string }

export interface SharedComment { id: string; photoId: string; authorAccountId: string; authorName: string; text: string; point: { x: number; y: number } | null; createdAtMs: number; resolvedAtMs: number | null }

export type CloudVariant = 'thumb' | 'preview' | 'original';
export interface CloudPhotoView { photoKey: string; name: string; previewBytes: number; thumbBytes: number | null; originalBytes: number | null }
export interface CloudUsage {
  month: string; usedCredits: number; allowanceCredits: number; bytes: number; downloads: number;
  /** Present on servers with the plan and balance (25 Nov 2026 pricing). */
  plan?: 'basic' | 'pro'; photosUsed?: number; photosIncluded?: number; balanceCredits?: number;
}

export interface CollabInvite { projectId: string; name: string; role: CollabRole }

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value);

function kindFor(status: number, code: string): CollabErrorKind {
  if (code === 'COLLAB_NOT_CONFIGURED' || code === 'PRESENCE_NOT_CONFIGURED' || code === 'GALLERY_NOT_CONFIGURED' || code === 'CLOUD_NOT_CONFIGURED') return 'not-configured';
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
    throw new CollabError(kindFor(response.status, code), code, typeof error.message === 'string' ? error.message : undefined, isRecord(error.detail) ? error.detail : {});
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
  /** Publishes the given previews as a client gallery and returns the link's secret token. */
  publishGallery(projectId: string, options: GalleryRequest, previews: { photoId: string; jpeg: Blob; thumb?: Blob | null }[]): Promise<{ galleryId: string; linkToken: string; expiresAtMs: number; published: number }>;
  galleries(projectId: string): Promise<GalleryListItem[]>;
  galleryFeedback(galleryId: string): Promise<GalleryFeedbackEvent[]>;
  revokeGallery(galleryId: string): Promise<void>;
  leases(projectId: string): Promise<SharedLeaseView[]>;
  acquire(projectId: string, photoKey: string, deviceId: string): Promise<{ token: string; baseRevisionId: string | null }>;
  heartbeat(projectId: string, photoKey: string, token: string, editing: boolean): Promise<void>;
  release(projectId: string, photoKey: string, token: string, action: 'checked-in' | 'released'): Promise<void>;
  history(projectId: string, photoKey: string): Promise<{ headId: string | null; revisions: SharedRevisionMeta[] }>;
  revision(projectId: string, photoKey: string, revisionId: string): Promise<{ recipe: Record<string, unknown> } & SharedRevisionMeta>;
  publish(projectId: string, photoKey: string, request: { token: string; baseRevisionId: string | null; recipe: Record<string, unknown>; virtualCopyOf?: string }): Promise<SharedRevisionMeta>;
  comments(projectId: string, photoKey: string): Promise<SharedComment[]>;
  addComment(projectId: string, photoKey: string, text: string, point: { x: number; y: number } | null): Promise<SharedComment>;
  resolveComment(projectId: string, commentId: string, resolved: boolean): Promise<SharedComment>;
  cloudPhotos(projectId: string): Promise<CloudPhotoView[]>;
  /** Puts one file in the project's cloud store; nothing is sent again when the same file is already there. */
  cloudUpload(projectId: string, photoKey: string, variant: CloudVariant, blob: Blob, name: string): Promise<void>;
  /** Downloads one cloud file. Counted against the project owner's allowance; the content is checked against its fingerprint. */
  cloudDownload(projectId: string, photoKey: string, variant: CloudVariant): Promise<Blob>;
  usage(): Promise<CloudUsage>;
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
    publishGallery: async (id, options, previews) => {
      const made = await call('POST', P(id) + '/galleries', { ...options });
      const galleryId = String(made.galleryId);
      let published = 0;
      const put = async (url: string, blob: Blob) => (await fetcher(url, { method: 'PUT', body: blob, headers: { 'content-type': 'image/jpeg', 'x-goog-content-length-range': `0,${blob.size}` }, credentials: 'omit', referrerPolicy: 'no-referrer' }).catch(() => null))?.ok === true;
      for (const { photoId, jpeg, thumb } of previews) {
        // The small filmstrip picture first: clients' browsers fetch it instead of the full preview while browsing.
        if (thumb) {
          const signedThumb = await call('POST', `/v1/collab/galleries/${encodeURIComponent(galleryId)}/photos/${encodeURIComponent(photoId)}/upload-url`, { sha256: await sha256Hex(thumb), bytes: thumb.size, variant: 'thumb' });
          if (!(await put(String(signedThumb.uploadUrl), thumb))) throw new CollabError('network', 'GALLERY_UPLOAD', 'A preview could not be uploaded. Nothing else was published for it.');
        }
        const signed = await call('POST', `/v1/collab/galleries/${encodeURIComponent(galleryId)}/photos/${encodeURIComponent(photoId)}/upload-url`, { sha256: await sha256Hex(jpeg), bytes: jpeg.size });
        if (!(await put(String(signed.uploadUrl), jpeg))) throw new CollabError('network', 'GALLERY_UPLOAD', 'A preview could not be uploaded. Nothing else was published for it.');
        await call('POST', `/v1/collab/galleries/${encodeURIComponent(galleryId)}/photos/${encodeURIComponent(photoId)}/commit`);
        published += 1;
      }
      return { galleryId, linkToken: String(made.linkToken), expiresAtMs: Number(made.expiresAtMs), published };
    },
    leases: async (id) => ((await call('GET', P(id) + '/leases')).leases ?? []) as SharedLeaseView[],
    acquire: async (id, key, deviceId) => {
      const lease = (await call('POST', `${P(id)}/photos/${encodeURIComponent(key)}/lease`, { deviceId })).lease as Json | undefined;
      if (!lease || typeof lease.token !== 'string') throw new CollabError('network');
      return { token: lease.token, baseRevisionId: typeof lease.baseRevisionId === 'string' ? lease.baseRevisionId : null };
    },
    heartbeat: async (id, key, token, editing) => { await call('POST', `${P(id)}/photos/${encodeURIComponent(key)}/heartbeat`, { token, editing }); },
    release: async (id, key, token, action) => { await call('POST', `${P(id)}/photos/${encodeURIComponent(key)}/release`, { token, action }); },
    history: async (id, key) => {
      const data = await call('GET', `${P(id)}/photos/${encodeURIComponent(key)}/revisions`);
      return { headId: typeof data.headId === 'string' ? data.headId : null, revisions: (data.revisions ?? []) as SharedRevisionMeta[] };
    },
    revision: async (id, key, rid) => (await call('GET', `${P(id)}/photos/${encodeURIComponent(key)}/revisions/${encodeURIComponent(rid)}`)) as unknown as { recipe: Record<string, unknown> } & SharedRevisionMeta,
    publish: async (id, key, request) => (await call('POST', `${P(id)}/photos/${encodeURIComponent(key)}/revisions`, request)).revision as SharedRevisionMeta,
    comments: async (id, key) => ((await call('GET', `${P(id)}/photos/${encodeURIComponent(key)}/comments`)).comments ?? []) as SharedComment[],
    addComment: async (id, key, text, point) => (await call('POST', `${P(id)}/photos/${encodeURIComponent(key)}/comments`, { text, point })).comment as SharedComment,
    resolveComment: async (id, cid, resolved) => (await call('POST', `${P(id)}/comments/${encodeURIComponent(cid)}/resolve`, { resolved })).comment as SharedComment,
    cloudPhotos: async (id) => ((await call('GET', `${P(id)}/cloud`)).photos ?? []) as CloudPhotoView[],
    cloudUpload: async (id, key, variant, blob, name) => {
      const base = `${P(id)}/photos/${encodeURIComponent(key)}/cloud`;
      const signed = await call('POST', `${base}/upload-url`, { variant, sha256: await sha256Hex(blob), bytes: blob.size, name: name.slice(0, 200) || 'Photo' });
      if (signed.alreadyStored === true) return;
      const put = await fetcher(String(signed.uploadUrl), { method: 'PUT', body: blob, headers: { 'content-type': variant === 'original' ? 'application/octet-stream' : 'image/jpeg', 'x-goog-content-length-range': `0,${blob.size}` }, credentials: 'omit', referrerPolicy: 'no-referrer' }).catch(() => null);
      if (!put?.ok) throw new CollabError('network', 'CLOUD_UPLOAD', 'A photo could not be put in the cloud. Nothing else changed.');
      await call('POST', `${base}/commit`, { variant });
    },
    cloudDownload: async (id, key, variant) => {
      const signed = await call('POST', `${P(id)}/photos/${encodeURIComponent(key)}/cloud/download-url`, { variant });
      const got = await fetcher(String(signed.downloadUrl), { credentials: 'omit', referrerPolicy: 'no-referrer' }).catch(() => null);
      if (!got?.ok) throw new CollabError('network', 'CLOUD_DOWNLOAD', 'A photo could not be downloaded from the cloud.');
      const blob = await got.blob();
      if (typeof signed.sha256 === 'string' && (await sha256Hex(blob)) !== signed.sha256) throw new CollabError('refused', 'CLOUD_MISMATCH', 'A downloaded photo did not match what was stored, so it was not used.');
      return blob;
    },
    usage: async () => (await call('GET', '/v1/me/usage')) as unknown as CloudUsage,
    galleries: async (id) => ((await call('GET', P(id) + '/galleries')).galleries ?? []) as GalleryListItem[],
    galleryFeedback: async (gid) => ((await call('GET', `/v1/collab/galleries/${encodeURIComponent(gid)}/feedback`)).events ?? []) as GalleryFeedbackEvent[],
    revokeGallery: async (gid) => { await call('POST', `/v1/collab/galleries/${encodeURIComponent(gid)}/revoke`); },
    presenceToken: async (id) => (await call('POST', P(id) + '/presence-token')) as unknown as { customToken: string; databaseUrl: string; uid: string; expiresAtMs: number },
  };
}

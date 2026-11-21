import { healthFromFailure } from '../core/connections';
import { isDesktopApp } from './desktopShell';
import { isInsideExportRoot, isInsideSyncRoot, isWritablePath, type StorageConnector } from '../core/storageConnectors';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export interface CloudDeps { getToken: () => Promise<string>; fetchImpl?: FetchLike }

/** The desktop app's own HTTP client has no cross-origin limits; the browser's fetch is used on the web. */
const plainFetch: FetchLike = async (input, init) => (isDesktopApp() ? ((await import('@tauri-apps/plugin-http')).fetch as FetchLike)(input, init) : fetch(input, init));

export class CloudError extends Error { constructor(message: string, readonly status = 0) { super(message); } }

export function explainCloudFailure(name: string, status: number): string {
  if (status === 401 || status === 403) return `${name} no longer accepts the sign-in. Sign in again to carry on.`;
  if (status === 404) return `${name} could not find that file.`;
  if (status === 409 || status === 412) return 'A file is already there. It was not replaced.';
  if (status === 429) return `${name} asked Kestrel to slow down. Try again in a minute.`;
  if (status === 507 || status === 413) return `${name} says there is no room left in the account.`;
  return `${name} answered with an error (${status}).`;
}

const guardPath = (path: string, name: string) => { if (!isInsideSyncRoot(path.replace(/\/+$/, ''))) throw new CloudError(`Path is outside the Kestrel folder in ${name}.`); };

function sender(name: string, deps: CloudDeps) {
  return async (url: string, init: RequestInit = {}): Promise<Response> => {
    const fetchImpl = deps.fetchImpl ?? plainFetch;
    let token: string;
    try { token = await deps.getToken(); } catch (error) { throw new CloudError(error instanceof Error ? error.message : `Sign in to ${name} again.`, 401); }
    try {
      return await fetchImpl(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` } });
    } catch { throw new CloudError(`Could not reach ${name}. Check your connection; your work is safe here.`); }
  };
}

const failed = (name: string, response: Response) => new CloudError(explainCloudFailure(name, response.status), response.status);

async function testWith(name: string, probe: () => Promise<Response>) {
  try {
    const response = await probe();
    return response.ok ? { ok: true as const } : { ok: false as const, reason: explainCloudFailure(name, response.status), health: healthFromFailure({ status: response.status }) };
  } catch (error) {
    const status = error instanceof CloudError ? error.status : 0;
    return { ok: false as const, reason: error instanceof Error ? error.message : `Could not reach ${name}.`, health: healthFromFailure(status ? { status } : { network: true }) };
  }
}

// ---------------------------------------------------------------- Dropbox (App folder: paths are relative to it)

const DROPBOX_SINGLE_UPLOAD_LIMIT = 150 * 1024 * 1024;

export function dropboxConnector(deps: CloudDeps): StorageConnector {
  const send = sender('Dropbox', deps);
  const rpc = (endpoint: string, body: unknown) => send(`https://api.dropboxapi.com/2/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  // The API-Arg header must be plain ASCII; sync paths are limited to safe characters, but escape anything else anyway.
  const arg = (value: unknown) => JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return {
    kind: 'folder',
    test: () => testWith('Dropbox', () => rpc('users/get_current_account', null).then((r) => r)),
    async put(path, bytes) {
      if (!isWritablePath(path)) throw new CloudError('Path is outside the Kestrel folder in Dropbox.');
      if (bytes.byteLength > DROPBOX_SINGLE_UPLOAD_LIMIT) throw new CloudError('This file is larger than Dropbox accepts in one go (150 MB). Choose a Dropbox folder on your computer for very large files.');
      const noOverwrite = isInsideExportRoot(path);
      const response = await send('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': arg({ path: `/${path}`, mode: noOverwrite ? 'add' : 'overwrite', autorename: false, mute: true }) },
        body: bytes as unknown as BodyInit,
      });
      if (response.status === 409) throw new CloudError('An export already exists at this destination. The file was not replaced.', 409);
      if (!response.ok) throw failed('Dropbox', response);
    },
    async get(path) {
      guardPath(path, 'Dropbox');
      const response = await send('https://content.dropboxapi.com/2/files/download', { method: 'POST', headers: { 'Dropbox-API-Arg': arg({ path: `/${path}` }) } });
      if (response.status === 409) return null; // path/not_found
      if (!response.ok) throw failed('Dropbox', response);
      return new Uint8Array(await response.arrayBuffer());
    },
    async list(prefix) {
      guardPath(prefix, 'Dropbox');
      const files: string[] = [];
      let response = await rpc('files/list_folder', { path: `/${prefix.replace(/\/+$/, '')}`, recursive: true, limit: 2000 });
      for (;;) {
        if (response.status === 409) return [];
        if (!response.ok) throw failed('Dropbox', response);
        const page = await response.json() as { entries: { '.tag': string; path_display: string }[]; has_more: boolean; cursor: string };
        for (const entry of page.entries) if (entry['.tag'] === 'file') files.push(entry.path_display.replace(/^\/+/, ''));
        if (!page.has_more || files.length >= 5000) break;
        response = await rpc('files/list_folder/continue', { cursor: page.cursor });
      }
      return files.sort();
    },
    async remove(path) {
      guardPath(path, 'Dropbox');
      const response = await rpc('files/delete_v2', { path: `/${path}` });
      if (!response.ok && response.status !== 409) throw failed('Dropbox', response);
    },
  };
}

// ---------------------------------------------------------------- Google Drive (drive.file: only what Kestrel made)

const DRIVE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const quote = (name: string) => `'${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export function googleDriveConnector(deps: CloudDeps): StorageConnector {
  const send = sender('Google Drive', deps);
  const folderIds = new Map<string, string>();
  const json = async <T>(response: Response): Promise<T> => { if (!response.ok) throw failed('Google Drive', response); return response.json() as Promise<T>; };

  async function childOf(parentId: string, name: string, folder: boolean): Promise<{ id: string } | null> {
    const q = `name=${quote(name)} and ${quote(parentId)} in parents and trashed=false and mimeType${folder ? '=' : '!='}'${FOLDER_MIME}'`;
    const page = await json<{ files: { id: string }[] }>(await send(`${DRIVE}/files?${new URLSearchParams({ q, fields: 'files(id)', pageSize: '1', spaces: 'drive' })}`));
    return page.files[0] ?? null;
  }

  async function folderId(parts: string[], create: boolean): Promise<string | null> {
    let parent = 'root';
    for (let i = 0; i < parts.length; i += 1) {
      const key = parts.slice(0, i + 1).join('/');
      let id: string | undefined = folderIds.get(key);
      if (!id) {
        const found = await childOf(parent, parts[i], true);
        if (found) id = found.id;
        else if (create) id = (await json<{ id: string }>(await send(`${DRIVE}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: parts[i], mimeType: FOLDER_MIME, parents: [parent] }) }))).id;
        else return null;
        folderIds.set(key, id);
      }
      parent = id;
    }
    return parent;
  }

  const split = (path: string) => { const parts = path.split('/').filter(Boolean); return { folder: parts.slice(0, -1), name: parts[parts.length - 1] }; };

  async function upload(parent: string, name: string, bytes: Uint8Array, existingId?: string) {
    // One resumable request holds files of any size; the first call only says what is coming.
    const start = await send(existingId
      ? `${DRIVE_UPLOAD}/files/${existingId}?uploadType=resumable&fields=id`
      : `${DRIVE_UPLOAD}/files?uploadType=resumable&fields=id`, {
      method: existingId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/octet-stream', 'X-Upload-Content-Length': String(bytes.byteLength) },
      body: JSON.stringify(existingId ? {} : { name, parents: [parent] }),
    });
    if (!start.ok) throw failed('Google Drive', start);
    const location = start.headers.get('Location');
    if (!location) throw new CloudError('Google Drive did not accept the upload. Try again.');
    const done = await send(location, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes as unknown as BodyInit });
    if (!done.ok) throw failed('Google Drive', done);
  }

  async function walk(folder: string, prefix: string, out: string[]) {
    let pageToken = '';
    do {
      const q = `${quote(folder)} in parents and trashed=false`;
      const page = await json<{ files: { id: string; name: string; mimeType: string }[]; nextPageToken?: string }>(await send(`${DRIVE}/files?${new URLSearchParams({ q, fields: 'nextPageToken,files(id,name,mimeType)', pageSize: '200', ...(pageToken ? { pageToken } : {}) })}`));
      for (const item of page.files) {
        if (out.length >= 5000) return;
        if (item.mimeType === FOLDER_MIME) await walk(item.id, `${prefix}${item.name}/`, out); else out.push(`${prefix}${item.name}`);
      }
      pageToken = page.nextPageToken ?? '';
    } while (pageToken);
  }

  return {
    kind: 'folder',
    test: () => testWith('Google Drive', () => send(`${DRIVE}/about?fields=user(emailAddress)`)),
    async put(path, bytes) {
      if (!isWritablePath(path)) throw new CloudError('Path is outside the Kestrel folder in Google Drive.');
      const { folder, name } = split(path);
      const parent = (await folderId(folder, true))!;
      const existing = await childOf(parent, name, false);
      if (existing && isInsideExportRoot(path)) throw new CloudError('An export already exists at this destination. The file was not replaced.', 409);
      await upload(parent, name, bytes, existing?.id);
    },
    async get(path) {
      guardPath(path, 'Google Drive');
      const { folder, name } = split(path);
      const parent = await folderId(folder, false);
      const file = parent ? await childOf(parent, name, false) : null;
      if (!file) return null;
      const response = await send(`${DRIVE}/files/${file.id}?alt=media`);
      if (response.status === 404) return null;
      if (!response.ok) throw failed('Google Drive', response);
      return new Uint8Array(await response.arrayBuffer());
    },
    async list(prefix) {
      guardPath(prefix, 'Google Drive');
      const parts = prefix.split('/').filter(Boolean);
      const root = await folderId(parts, false);
      const out: string[] = [];
      if (root) await walk(root, `${parts.join('/')}/`, out);
      return out.sort();
    },
    async remove(path) {
      guardPath(path, 'Google Drive');
      const { folder, name } = split(path);
      const parent = await folderId(folder, false);
      const file = parent ? await childOf(parent, name, false) : null;
      if (!file) return;
      const response = await send(`${DRIVE}/files/${file.id}`, { method: 'DELETE' });
      if (!response.ok && response.status !== 404) throw failed('Google Drive', response);
    },
  };
}

// ---------------------------------------------------------------- OneDrive (App Folder: path addressed under /special/approot)

const GRAPH = 'https://graph.microsoft.com/v1.0/me/drive/special/approot';
const SMALL_UPLOAD = 4 * 1024 * 1024;
const CHUNK = 320 * 1024 * 10; // a multiple of 320 KiB, as Graph requires

export function oneDriveConnector(deps: CloudDeps): StorageConnector {
  const send = sender('OneDrive', deps);
  const at = (path: string) => `${GRAPH}:/${path.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`;
  return {
    kind: 'folder',
    test: () => testWith('OneDrive', () => send(GRAPH)),
    async put(path, bytes) {
      if (!isWritablePath(path)) throw new CloudError('Path is outside the Kestrel folder in OneDrive.');
      const behaviour = isInsideExportRoot(path) ? 'fail' : 'replace';
      const fail = (response: Response) => response.status === 409 && behaviour === 'fail' ? new CloudError('An export already exists at this destination. The file was not replaced.', 409) : failed('OneDrive', response);
      if (bytes.byteLength <= SMALL_UPLOAD) {
        const response = await send(`${at(path)}:/content?@microsoft.graph.conflictBehavior=${behaviour}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes as unknown as BodyInit });
        if (!response.ok) throw fail(response);
        return;
      }
      const session = await send(`${at(path)}:/createUploadSession`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': behaviour } }) });
      if (!session.ok) throw fail(session);
      const { uploadUrl } = await session.json() as { uploadUrl: string };
      for (let start = 0; start < bytes.byteLength; start += CHUNK) {
        const end = Math.min(start + CHUNK, bytes.byteLength);
        // The session URL is pre-authorised; it must not be sent our bearer token, so it goes through plain fetch.
        const fetchImpl = deps.fetchImpl ?? plainFetch;
        let response: Response;
        try { response = await fetchImpl(uploadUrl, { method: 'PUT', headers: { 'Content-Range': `bytes ${start}-${end - 1}/${bytes.byteLength}` }, body: bytes.slice(start, end) as unknown as BodyInit }); }
        catch { throw new CloudError('Could not reach OneDrive. Check your connection; your work is safe here.'); }
        if (!response.ok) throw failed('OneDrive', response);
      }
    },
    async get(path) {
      guardPath(path, 'OneDrive');
      const response = await send(`${at(path)}:/content`);
      if (response.status === 404) return null;
      if (!response.ok) throw failed('OneDrive', response);
      return new Uint8Array(await response.arrayBuffer());
    },
    async list(prefix) {
      guardPath(prefix, 'OneDrive');
      const root = prefix.replace(/\/+$/, '');
      const files: string[] = [];
      const queue = [root];
      while (queue.length && files.length < 5000) {
        const folder = queue.shift()!;
        let next: string | undefined = `${at(folder)}:/children?$select=name,folder&$top=200`;
        while (next) {
          const response: Response = await send(next);
          if (response.status === 404) break;
          if (!response.ok) throw failed('OneDrive', response);
          const page = await response.json() as { value: { name: string; folder?: unknown }[]; '@odata.nextLink'?: string };
          for (const item of page.value) { if (item.folder) queue.push(`${folder}/${item.name}`); else files.push(`${folder}/${item.name}`); }
          next = page['@odata.nextLink'];
        }
      }
      return files.sort();
    },
    async remove(path) {
      guardPath(path, 'OneDrive');
      const response = await send(at(path), { method: 'DELETE' });
      if (!response.ok && response.status !== 404) throw failed('OneDrive', response);
    },
  };
}

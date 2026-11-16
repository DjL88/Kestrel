import { healthFromFailure } from '../core/connections';
import { checkWebDavSettings, isInsideSyncRoot, isWritablePath, type StorageConnector, type WebDavSettings } from '../core/storageConnectors';
import { isDesktopApp } from './desktopShell';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function defaultFetch(): Promise<FetchLike> {
  if (isDesktopApp()) return (await import('@tauri-apps/plugin-http')).fetch as FetchLike;
  return (input, init) => fetch(input, init);
}

export class DavError extends Error { constructor(message: string, readonly status = 0) { super(message); } }

export function explainDavFailure(status: number): string {
  if (status === 401 || status === 403) return 'The NAS did not accept the user name and password. Check them, and that this user may use WebDAV.';
  if (status === 404) return 'The folder was not found on the NAS. Check the address, including the folder name at the end.';
  if (status === 405 || status === 501) return 'That address does not accept WebDAV. Check that WebDAV is turned on in the NAS and that the address is its WebDAV address.';
  return `The NAS answered with an error (${status}).`;
}

const unescapeXml = (text: string) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const basic = (settings: WebDavSettings) => `Basic ${btoa(unescape(encodeURIComponent(`${settings.username}:${settings.password}`)))}`;

/** Read the files and folders out of a PROPFIND answer, whichever prefix the server uses for its XML names. */
export function parsePropfind(xml: string): { href: string; isFolder: boolean }[] {
  const out: { href: string; isFolder: boolean }[] = [];
  for (const block of xml.split(/<(?:\w+:)?response[\s>]/i).slice(1)) {
    const href = /<(?:\w+:)?href>([\s\S]*?)<\/(?:\w+:)?href>/i.exec(block)?.[1];
    if (href) out.push({ href: decodeURIComponent(unescapeXml(href.trim())), isFolder: /<(?:\w+:)?collection\s*\/?>/i.test(block) });
  }
  return out;
}

export function webdavConnector(settings: WebDavSettings, options: { fetchImpl?: FetchLike } = {}): StorageConnector {
  const base = new URL(settings.url.endsWith('/') ? settings.url : `${settings.url}/`);
  const urlFor = (path: string) => new URL(path.split('/').filter(Boolean).map(encodeURIComponent).join('/'), base);

  async function send(method: string, url: URL, init: { body?: Uint8Array; headers?: Record<string, string> } = {}): Promise<Response> {
    const fetchImpl = options.fetchImpl ?? await defaultFetch();
    try {
      return await fetchImpl(url.toString(), { method, headers: { Authorization: basic(settings), ...init.headers }, ...(init.body ? { body: init.body as unknown as BodyInit } : {}) });
    } catch {
      throw new DavError(isDesktopApp()
        ? 'Could not reach the NAS. Check the address and that it is switched on and on the same network.'
        : 'Could not reach the NAS from the browser. Check the address; the NAS must also allow requests from this page (CORS), which the desktop app does not need.');
    }
  }

  const guard = (path: string) => { if (!isInsideSyncRoot(path.replace(/\/+$/, ''))) throw new DavError('Path is outside the Kestrel folder.'); };

  /** Make each folder on the way to a file. A folder that already exists answers 405, which is fine. */
  async function ensureFolders(path: string) {
    const parts = path.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i += 1) {
      const response = await send('MKCOL', urlFor(`${parts.slice(0, i).join('/')}/`));
      if (!response.ok && response.status !== 405 && response.status !== 301) throw new DavError(explainDavFailure(response.status), response.status);
    }
  }

  async function listFolder(path: string): Promise<{ href: string; isFolder: boolean }[]> {
    const response = await send('PROPFIND', urlFor(`${path.replace(/\/+$/, '')}/`), { headers: { Depth: '1', 'Content-Type': 'application/xml' }, body: new TextEncoder().encode('<?xml version="1.0"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>') });
    if (response.status === 404) return [];
    if (response.status !== 207 && !response.ok) throw new DavError(explainDavFailure(response.status), response.status);
    return parsePropfind(await response.text());
  }

  return {
    kind: 'webdav',
    async test() {
      const problems = checkWebDavSettings(settings);
      if (problems.length) return { ok: false as const, reason: problems[0] };
      try {
        const response = await send('PROPFIND', new URL(base), { headers: { Depth: '0' } });
        return response.status === 207 || response.ok ? { ok: true as const } : { ok: false as const, reason: explainDavFailure(response.status), health: healthFromFailure({ status: response.status }) };
      } catch (error) {
        return { ok: false as const, reason: error instanceof Error ? error.message : 'Could not reach the NAS.', health: healthFromFailure({ network: true }) };
      }
    },
    async put(path, bytes) {
      if (!isWritablePath(path)) throw new DavError('Path is outside the Kestrel folder.');
      await ensureFolders(path);
      const response = await send('PUT', urlFor(path), { body: bytes, headers: { 'Content-Type': 'application/octet-stream' } });
      if (!response.ok) throw new DavError(explainDavFailure(response.status), response.status);
    },
    async get(path) {
      guard(path);
      const response = await send('GET', urlFor(path));
      if (response.status === 404) return null;
      if (!response.ok) throw new DavError(explainDavFailure(response.status), response.status);
      return new Uint8Array(await response.arrayBuffer());
    },
    async list(prefix) {
      guard(prefix);
      const root = prefix.replace(/\/+$/, '');
      const rootPath = base.pathname.replace(/\/+$/, '');
      const files: string[] = [];
      const queue = [root];
      while (queue.length && files.length < 5000) {
        const folder = queue.shift()!;
        for (const entry of await listFolder(folder)) {
          // Servers answer with full paths; take what is below the address the person entered.
          const full = entry.href.replace(/^[a-z]+:\/\/[^/]+/i, '');
          const relative = full.startsWith(rootPath) ? full.slice(rootPath.length).replace(/^\/+|\/+$/g, '') : full.replace(/^\/+|\/+$/g, '');
          if (!relative || relative === folder) continue;
          if (entry.isFolder) queue.push(relative); else files.push(relative);
        }
      }
      return files.sort();
    },
    async remove(path) {
      guard(path);
      const response = await send('DELETE', urlFor(path));
      if (!response.ok && response.status !== 404) throw new DavError(explainDavFailure(response.status), response.status);
    },
  };
}

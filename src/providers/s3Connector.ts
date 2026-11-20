import { healthFromFailure } from '../core/connections';
import { sha256Hex, signV4 } from '../core/sigv4';
import { checkS3Settings, isInsideExportRoot, isInsideSyncRoot, isWritablePath, type S3Settings, type StorageConnector } from '../core/storageConnectors';
import { isDesktopApp } from './desktopShell';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * The desktop app sends storage requests through its own network layer, which is not held back by a website's cross-origin
 * rules. In a web page the bucket has to allow it (CORS), and the settings screen says so when a request cannot be made.
 */
async function defaultFetch(): Promise<FetchLike> {
  if (isDesktopApp()) return (await import('@tauri-apps/plugin-http')).fetch as FetchLike;
  return (input, init) => fetch(input, init);
}

const trimSlashes = (text: string) => text.replace(/^\/+|\/+$/g, '');
const unescapeXml = (text: string) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export class S3Error extends Error {
  constructor(message: string, readonly status = 0) { super(message); }
}

/** A plain explanation of a failed request. */
export function explainS3Failure(status: number): string {
  if (status === 403) return 'The storage did not accept the keys. Check the access key, the secret key and the region.';
  if (status === 404) return 'The bucket was not found. Check its name and the address.';
  if (status === 301 || status === 400) return 'The region may be wrong for this bucket.';
  return `The storage answered with an error (${status}).`;
}

/** Whether to put the bucket in the address (Amazon's own addresses) or in the path (everyone else, and older setups). */
const virtualHosted = (settings: S3Settings) => settings.pathStyle === false || (settings.pathStyle === undefined && /(^|\.)amazonaws\.com$/.test(new URL(settings.endpoint).hostname));

export function s3Connector(settings: S3Settings, options: { fetchImpl?: FetchLike; now?: () => Date } = {}): StorageConnector {
  const now = options.now ?? (() => new Date());
  const base = new URL(settings.endpoint);
  const objectUrl = (key: string, query?: Record<string, string>) => {
    const url = new URL(base.toString());
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    if (virtualHosted(settings)) { url.hostname = `${settings.bucket}.${url.hostname}`; url.pathname = `/${encodedKey}`; }
    else url.pathname = `/${[settings.bucket, encodedKey].filter(Boolean).join('/')}`;
    for (const [name, value] of Object.entries(query ?? {})) url.searchParams.set(name, value);
    return url;
  };

  async function send(method: string, url: URL, body?: Uint8Array, requestHeaders?: Record<string, string>): Promise<Response> {
    const fetchImpl = options.fetchImpl ?? await defaultFetch();
    const payload = body ?? new Uint8Array();
    const headers = await signV4({
      method, url, region: settings.region, service: 's3', accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey,
      payloadHash: await sha256Hex(payload), now: now(), headers: requestHeaders,
    });
    let response: Response;
    try {
      response = await fetchImpl(url.toString(), { method, headers: { ...headers, ...requestHeaders }, ...(body ? { body: body as unknown as BodyInit } : {}) });
    } catch {
      throw new S3Error(isDesktopApp()
        ? 'Could not reach the storage. Check the address and your connection.'
        : 'Could not reach the storage from the browser. Check the address; the bucket must also allow requests from this page (CORS), which the desktop app does not need.');
    }
    return response;
  }

  const guard = (path: string) => { if (!isInsideSyncRoot(path.replace(/\/+$/, ''))) throw new S3Error('Path is outside the Kestrel folder.'); };

  return {
    kind: 's3',
    async test() {
      const problems = checkS3Settings(settings);
      if (problems.length) return { ok: false as const, reason: problems[0] };
      try {
        const response = await send('GET', objectUrl('', { 'list-type': '2', 'max-keys': '1' }));
        return response.ok ? { ok: true as const } : { ok: false as const, reason: explainS3Failure(response.status), health: healthFromFailure({ status: response.status }) };
      } catch (error) {
        return { ok: false as const, reason: error instanceof Error ? error.message : 'Could not reach the storage.', health: healthFromFailure({ network: true }) };
      }
    },
    async put(path, bytes) {
      if (!isWritablePath(path)) throw new S3Error('Path is outside the Kestrel folder.');
      const exportWrite = isInsideExportRoot(path);
      const response = await send('PUT', objectUrl(path), bytes, {
        'content-type': 'application/octet-stream',
        ...(exportWrite ? { 'if-none-match': '*' } : {}),
      });
      if (exportWrite && (response.status === 409 || response.status === 412)) {
        throw new S3Error('An export already exists at this destination or is being written. The file was not replaced.', response.status);
      }
      if (!response.ok) throw new S3Error(explainS3Failure(response.status), response.status);
    },
    async get(path) {
      guard(path);
      const response = await send('GET', objectUrl(path));
      if (response.status === 404) return null;
      if (!response.ok) throw new S3Error(explainS3Failure(response.status), response.status);
      return new Uint8Array(await response.arrayBuffer());
    },
    async list(prefix) {
      guard(prefix);
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const response = await send('GET', objectUrl('', { 'list-type': '2', prefix: `${trimSlashes(prefix)}/`, ...(token ? { 'continuation-token': token } : {}) }));
        if (!response.ok) throw new S3Error(explainS3Failure(response.status), response.status);
        const xml = await response.text();
        for (const match of xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)) keys.push(unescapeXml(match[1]));
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? unescapeXml(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1] ?? '') || undefined : undefined;
      } while (token);
      return keys.sort();
    },
    async remove(path) {
      guard(path);
      const response = await send('DELETE', objectUrl(path));
      if (!response.ok && response.status !== 404) throw new S3Error(explainS3Failure(response.status), response.status);
    },
  };
}

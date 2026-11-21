import assert from 'node:assert/strict';
import test from 'node:test';
import { dropboxConnector, googleDriveConnector, oneDriveConnector } from './cloudDriveConnectors.ts';

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array | null) => (data ? new TextDecoder().decode(data) : null);
const reply = (status: number, body?: unknown) => new Response(body === undefined ? null : typeof body === 'string' || body instanceof Uint8Array ? (body as BodyInit) : JSON.stringify(body), { status });
const asBytes = async (body: unknown) => (body instanceof Uint8Array ? body : new Uint8Array(await new Response(body as BodyInit).arrayBuffer()));

/** A tiny Dropbox: files by path, only the calls the connector makes. */
function fakeDropbox() {
  const files = new Map<string, Uint8Array>();
  const seen: string[] = [];
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    seen.push(`${(init.headers as Record<string, string>).Authorization}`);
    const arg = init.headers && (init.headers as Record<string, string>)['Dropbox-API-Arg'] ? JSON.parse((init.headers as Record<string, string>)['Dropbox-API-Arg']) : null;
    if (url.endsWith('/users/get_current_account')) return reply(200, {});
    if (url.endsWith('/files/upload')) { if (arg.mode === 'add' && files.has(arg.path)) return reply(409, {}); files.set(arg.path, await asBytes(init.body)); return reply(200, {}); }
    if (url.endsWith('/files/download')) return files.has(arg.path) ? reply(200, files.get(arg.path)!) : reply(409, {});
    if (url.endsWith('/files/list_folder')) {
      const { path } = JSON.parse(init.body as string);
      return reply(200, { entries: [...files.keys()].filter((p) => p.startsWith(`${path}/`)).map((p) => ({ '.tag': 'file', path_display: p })), has_more: false, cursor: '' });
    }
    if (url.endsWith('/files/delete_v2')) { files.delete(JSON.parse(init.body as string).path); return reply(200, {}); }
    return reply(500);
  };
  return { files, seen, fetchImpl };
}

test('Dropbox: put, get, list and remove stay inside the Kestrel folder and send the token', async () => {
  const fake = fakeDropbox();
  const connector = dropboxConnector({ getToken: async () => 'tok', fetchImpl: fake.fetchImpl });
  assert.deepEqual(await connector.test(), { ok: true });
  await connector.put('kestrel/v1/recipes/p1/a.json', bytes('{}'), 'h');
  assert.equal(text(await connector.get('kestrel/v1/recipes/p1/a.json')), '{}');
  assert.deepEqual(await connector.list('kestrel/v1/recipes'), ['kestrel/v1/recipes/p1/a.json']);
  await connector.remove('kestrel/v1/recipes/p1/a.json');
  assert.equal(await connector.get('kestrel/v1/recipes/p1/a.json'), null);
  assert.ok(fake.seen.every((header) => header === 'Bearer tok'));
  await assert.rejects(connector.put('../escape.txt', bytes('x'), 'h'));
  await assert.rejects(connector.get('somewhere/else.json'));
});

test('Dropbox: an export is never replaced, a normal sync file is', async () => {
  const connector = dropboxConnector({ getToken: async () => 't', fetchImpl: fakeDropbox().fetchImpl });
  await connector.put('export/a.jpg', bytes('1'), 'h');
  await assert.rejects(connector.put('export/a.jpg', bytes('2'), 'h'), /not replaced/);
  await connector.put('kestrel/v1/recipes/p/a.json', bytes('1'), 'h');
  await connector.put('kestrel/v1/recipes/p/a.json', bytes('2'), 'h');
});

test('Dropbox: a rejected sign-in becomes a needs-signin health with plain words', async () => {
  const connector = dropboxConnector({ getToken: async () => 't', fetchImpl: async () => reply(401) });
  const result = await connector.test();
  assert.equal(result.ok, false);
  if (!result.ok) { assert.equal(result.health, 'needs-signin'); assert.match(result.reason, /Sign in again/); }
});

test('an unreachable service reads as offline, and a lost token as needing sign-in', async () => {
  const offline = dropboxConnector({ getToken: async () => 't', fetchImpl: async () => { throw new TypeError('network'); } });
  const result = await offline.test();
  assert.ok(!result.ok && result.health === 'offline');
  const expired = oneDriveConnector({ getToken: async () => { throw new Error('Sign in to OneDrive again.'); } });
  const second = await expired.test();
  assert.ok(!second.ok && second.health === 'needs-signin');
});

/** A tiny OneDrive: Graph path addressing, with the small and the session upload. */
function fakeOneDrive() {
  const files = new Map<string, Uint8Array>();
  const behaviours: string[] = [];
  const chunks: string[] = [];
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    if (u.hostname === 'upload.test') { chunks.push(String((init.headers as Record<string, string>)['Content-Range'])); assert.equal((init.headers as Record<string, string>).Authorization, undefined); return reply(200, {}); }
    const m = /approot:\/(.*?):\/(content|children|createUploadSession)$/.exec(decodeURIComponent(u.pathname));
    if (!m) return u.pathname.endsWith('/approot') ? reply(200, {}) : reply(404);
    const [, path, op] = m;
    if (op === 'content' && init.method === 'PUT') { behaviours.push(u.searchParams.get('@microsoft.graph.conflictBehavior') ?? ''); if (u.searchParams.get('@microsoft.graph.conflictBehavior') === 'fail' && files.has(path)) return reply(409); files.set(path, await asBytes(init.body)); return reply(201, {}); }
    if (op === 'content') return files.has(path) ? reply(200, files.get(path)!) : reply(404);
    if (op === 'createUploadSession') return reply(200, { uploadUrl: 'https://upload.test/session' });
    if (op === 'children') {
      const value = [...files.keys()].filter((p) => p.startsWith(`${path}/`)).map((p) => ({ name: p.slice(path.length + 1) })).filter((e) => !e.name.includes('/'));
      const folders = new Set([...files.keys()].filter((p) => p.startsWith(`${path}/`)).map((p) => p.slice(path.length + 1)).filter((n) => n.includes('/')).map((n) => n.split('/')[0]));
      return reply(200, { value: [...value, ...[...folders].map((name) => ({ name, folder: {} }))] });
    }
    return reply(500);
  };
  return { files, behaviours, chunks, fetchImpl };
}

test('OneDrive: round trip, nested listing, export never replaced', async () => {
  const fake = fakeOneDrive();
  const connector = oneDriveConnector({ getToken: async () => 't', fetchImpl: fake.fetchImpl });
  await connector.put('kestrel/v1/previews/p1/a.jpg', bytes('jpg'), 'h');
  assert.equal(text(await connector.get('kestrel/v1/previews/p1/a.jpg')), 'jpg');
  assert.deepEqual(await connector.list('kestrel/v1/previews'), ['kestrel/v1/previews/p1/a.jpg']);
  await connector.put('export/x.jpg', bytes('1'), 'h');
  await assert.rejects(connector.put('export/x.jpg', bytes('2'), 'h'), /not replaced/);
  assert.deepEqual(fake.behaviours, ['replace', 'fail', 'fail']);
});

test('OneDrive: a large file goes up in chunks that are multiples of 320 KiB, without the bearer token on the session URL', async () => {
  const fake = fakeOneDrive();
  const connector = oneDriveConnector({ getToken: async () => 't', fetchImpl: fake.fetchImpl });
  await connector.put('kestrel/v1/originals/p1/a.orig', new Uint8Array(7 * 1024 * 1024), 'h');
  assert.deepEqual(fake.chunks, ['bytes 0-3276799/7340032', 'bytes 3276800-6553599/7340032', 'bytes 6553600-7340031/7340032']);
});

/** A tiny Google Drive: folders and files with ids and parents, the queries the connector makes, resumable upload. */
function fakeDrive() {
  type Item = { id: string; name: string; mimeType: string; parent: string; data?: Uint8Array };
  const items: Item[] = [];
  let n = 0;
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/about')) return reply(200, {});
    if (u.pathname === '/upload/drive/v3/files' || /^\/upload\/drive\/v3\/files\/.+/.test(u.pathname)) {
      const meta = JSON.parse(init.body as string);
      const id = u.pathname.split('/').pop() === 'files' ? `f${++n}` : u.pathname.split('/').pop()!;
      if (u.pathname.endsWith('/files')) items.push({ id, name: meta.name, mimeType: 'application/octet-stream', parent: meta.parents[0] });
      return new Response(null, { status: 200, headers: { Location: `https://upload.test/${id}` } });
    }
    if (u.hostname === 'upload.test') { items.find((i) => i.id === u.pathname.slice(1))!.data = await asBytes(init.body); return reply(200, {}); }
    if (u.pathname === '/drive/v3/files' && init.method === 'POST') { const meta = JSON.parse(init.body as string); const id = `f${++n}`; items.push({ id, name: meta.name, mimeType: meta.mimeType, parent: meta.parents[0] }); return reply(200, { id }); }
    if (u.pathname === '/drive/v3/files') {
      const q = u.searchParams.get('q')!;
      const parent = /'([^']+)' in parents/.exec(q)![1];
      const name = /name='([^']+)'/.exec(q)?.[1];
      const wantFolder = /mimeType='/.test(q) ? true : /mimeType!=/.test(q) ? false : undefined;
      const hits = items.filter((i) => i.parent === parent && (!name || i.name === name) && (wantFolder === undefined || (i.mimeType === 'application/vnd.google-apps.folder') === wantFolder));
      return reply(200, { files: hits.map((i) => ({ id: i.id, name: i.name, mimeType: i.mimeType })) });
    }
    const id = u.pathname.split('/').pop()!;
    const item = items.find((i) => i.id === id);
    if (init.method === 'DELETE') { if (item) items.splice(items.indexOf(item), 1); return reply(204); }
    if (u.searchParams.get('alt') === 'media') return item?.data ? reply(200, item.data) : reply(404);
    return reply(500);
  };
  return { items, fetchImpl };
}

test('Google Drive: real folders are made once, files round-trip, replaced in place, listed and removed', async () => {
  const fake = fakeDrive();
  const connector = googleDriveConnector({ getToken: async () => 't', fetchImpl: fake.fetchImpl });
  assert.deepEqual(await connector.test(), { ok: true });
  await connector.put('kestrel/v1/recipes/p1/a.json', bytes('one'), 'h');
  await connector.put('kestrel/v1/recipes/p1/a.json', bytes('two'), 'h');
  await connector.put('kestrel/v1/recipes/p1/b.json', bytes('b'), 'h');
  assert.equal(fake.items.filter((i) => i.mimeType.endsWith('folder')).length, 4, 'one folder per path part, created once');
  assert.equal(fake.items.filter((i) => i.name === 'a.json').length, 1, 'replaced in place, not duplicated');
  assert.equal(text(await connector.get('kestrel/v1/recipes/p1/a.json')), 'two');
  assert.deepEqual(await connector.list('kestrel/v1/recipes'), ['kestrel/v1/recipes/p1/a.json', 'kestrel/v1/recipes/p1/b.json']);
  assert.equal(await connector.get('kestrel/v1/recipes/p1/missing.json'), null);
  await connector.remove('kestrel/v1/recipes/p1/b.json');
  assert.deepEqual(await connector.list('kestrel/v1/recipes'), ['kestrel/v1/recipes/p1/a.json']);
  await assert.rejects(connector.get('elsewhere/a.json'));
});

test('Google Drive: an existing export is not replaced', async () => {
  const connector = googleDriveConnector({ getToken: async () => 't', fetchImpl: fakeDrive().fetchImpl });
  await connector.put('export/a.jpg', bytes('1'), 'h');
  await assert.rejects(connector.put('export/a.jpg', bytes('2'), 'h'), /not replaced/);
});

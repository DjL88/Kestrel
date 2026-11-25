import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256Plain } from '../core/sha256';
import type { OptionalModel } from '../core/optionalModels';
import { downloadOptionalModel, optionalModelStatus, readOptionalModelFile, removeOptionalModel, type PackDeps, type PackStore } from './optionalModels';

const payload = new Uint8Array(5000).map((_, i) => (i * 7) % 251);
const pack = (bytes = payload, sha256 = sha256Plain(payload), url = '/models/test.onnx'): OptionalModel => ({
  id: 'test', name: 'Test pack', job: 'test', licence: 'MIT', source: 'test', tier: 'phone', fallback: 'none', cache: 'test-v1',
  files: { model: { url, sha256, bytes: bytes.byteLength } },
});

function memoryStore(): PackStore & { map: Map<string, Blob> } {
  const map = new Map<string, Blob>();
  return {
    map,
    get: async (c, k) => map.get(`${c}|${k}`),
    has: async (c, k) => map.has(`${c}|${k}`),
    put: async (c, k, b) => { map.set(`${c}|${k}`, b); },
    remove: async (c, k) => { map.delete(`${c}|${k}`); },
  };
}

const serving = (body: Uint8Array, calls: string[] = []): typeof fetch => (async (url: string) => {
  calls.push(String(url));
  return new Response(new Blob([body as BlobPart]).stream());
}) as unknown as typeof fetch;

test('no address means unavailable, and no request is ever made', async () => {
  const calls: string[] = [];
  const deps: PackDeps = { store: memoryStore(), fetch: serving(payload, calls) };
  const model = pack(payload, sha256Plain(payload), '');
  assert.equal(await optionalModelStatus(model, deps), 'unavailable');
  await assert.rejects(downloadOptionalModel(model, () => undefined, undefined, deps), /not offered/);
  assert.deepEqual(calls, []);
});

test('a matching download is kept, read back checked, and removable', async () => {
  const store = memoryStore();
  const deps: PackDeps = { store, fetch: serving(payload) };
  const model = pack();
  assert.equal(await optionalModelStatus(model, deps), 'not-downloaded');
  const progress: number[] = [];
  await downloadOptionalModel(model, (f) => progress.push(f), undefined, deps);
  assert.equal(progress.at(-1), 1);
  assert.equal(await optionalModelStatus(model, deps), 'ready');
  assert.deepEqual(await readOptionalModelFile(model, 'model', deps), payload);
  await removeOptionalModel(model, deps);
  assert.equal(await optionalModelStatus(model, deps), 'not-downloaded');
});

test('a file that does not match its checksum is refused and not kept', async () => {
  const store = memoryStore();
  const tampered = payload.slice(); tampered[10] ^= 1;
  await assert.rejects(downloadOptionalModel(pack(), () => undefined, undefined, { store, fetch: serving(tampered) }), /checksum/);
  assert.equal(store.map.size, 0);
  const longer = new Uint8Array(payload.byteLength + 1);
  await assert.rejects(downloadOptionalModel(pack(), () => undefined, undefined, { store, fetch: serving(longer) }), /larger than expected/);
  assert.equal(store.map.size, 0);
});

test('a stored copy damaged later is never returned, and is removed', async () => {
  const store = memoryStore();
  const deps: PackDeps = { store, fetch: serving(payload) };
  const model = pack();
  await downloadOptionalModel(model, () => undefined, undefined, deps);
  const key = [...store.map.keys()][0];
  const damaged = payload.slice(); damaged[0] ^= 1;
  store.map.set(key, new Blob([damaged as BlobPart]));
  await assert.rejects(readOptionalModelFile(model, 'model', deps), /integrity/);
  assert.equal(store.map.size, 0);
});

test('with no address of its own, a pack is downloaded from the signed manifest, only when asked, and kept by digest', async () => {
  const { packUrlResolver } = await import('./packManifest');
  const { loadSigningKey, signEnvelope } = await import('../../services/control-plane/src/crypto.ts');
  const crypto = await import('node:crypto');
  const key = loadSigningKey('kestrel-test', crypto.generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }).toString());
  const model = pack(payload, sha256Plain(payload), '');
  const asset = { id: 'test', kind: 'onnx', version: '2026.11.25', path: '/data/onnx/test/2026.11.25/test-pack.onnx', sha256: sha256Plain(payload), bytes: payload.byteLength };
  const calls: string[] = [];
  let manifest: unknown = signEnvelope({ schema: 1, revision: 2, assets: [asset] }, key);
  const fetcher = (async (url: string) => {
    calls.push(String(url));
    return String(url).endsWith('/manifest/stable.json') ? new Response(JSON.stringify(manifest)) : new Response(new Blob([payload as BlobPart]).stream());
  }) as unknown as typeof fetch;
  const store = memoryStore();
  const deps: PackDeps = { store, fetch: fetcher, resolveUrl: packUrlResolver({ baseUrl: 'https://models.example.test', keys: { [key.keyId]: key.publicKeyBase64 }, fetch: fetcher }) };

  assert.equal(await optionalModelStatus(model, deps), 'not-downloaded', 'offered without any request');
  assert.deepEqual(calls, [], 'nothing is fetched until the photographer downloads');
  await downloadOptionalModel(model, () => undefined, undefined, deps);
  assert.deepEqual(calls, ['https://models.example.test/manifest/stable.json', 'https://models.example.test/data/onnx/test/2026.11.25/test-pack.onnx']);
  assert.deepEqual([...store.map.keys()], [`test-v1|test/model#${sha256Plain(payload)}`]);
  assert.equal(await optionalModelStatus(model, deps), 'ready');
  assert.deepEqual(await readOptionalModelFile(model, 'model', deps), payload);

  // A manifest that does not verify, or lists another file under this pack's id, never leads to a download.
  await removeOptionalModel(model, deps);
  for (const bad of [
    { ...signEnvelope({ schema: 1, revision: 2, assets: [asset] }, key), signature: 'A'.repeat(86) },
    signEnvelope({ schema: 1, revision: 2, assets: [{ ...asset, sha256: 'f'.repeat(64) }] }, key),
  ]) {
    manifest = bad; calls.length = 0;
    const fresh: PackDeps = { ...deps, resolveUrl: packUrlResolver({ baseUrl: 'https://models.example.test', keys: { [key.keyId]: key.publicKeyBase64 }, fetch: fetcher }) };
    await assert.rejects(downloadOptionalModel(model, () => undefined, undefined, fresh), /signature check|not in the list/);
    assert.deepEqual(calls, ['https://models.example.test/manifest/stable.json'], 'only the manifest was read');
  }
});

test('a copy kept under its old address is still found and checked', async () => {
  const store = memoryStore();
  const model = pack();
  await store.put(model.cache, `${model.files.model.url}#${model.files.model.sha256}`, new Blob([payload as BlobPart]));
  const deps: PackDeps = { store, fetch: serving(payload) };
  assert.equal(await optionalModelStatus(model, deps), 'ready');
  assert.deepEqual(await readOptionalModelFile(model, 'model', deps), payload);
  await removeOptionalModel(model, deps);
  assert.equal(store.map.size, 0);
});

import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import test from 'node:test';
import { MODEL_SLOTS } from '../core/modelUpdatePolicy.ts';
import { canonicalJson } from '../core/signedEnvelope.ts';
import { ModelUpdater, type ModelStoreLike } from './modelUpdater.ts';

const b64 = (b: ArrayBuffer) => Buffer.from(b).toString('base64');
async function keypair() {
  const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
  return { pair, pub: b64(await webcrypto.subtle.exportKey('raw', pair.publicKey)) };
}
const sign = async (pair: CryptoKeyPair, payload: unknown) => ({
  payload, keyId: 'k1', signature: b64(await webcrypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(canonicalJson(payload)))),
});

const BASE = 'https://models.example.test';
const bytesOf = (text: string) => new TextEncoder().encode(text);
const entry = (id: keyof typeof MODEL_SLOTS, version: string, body: Uint8Array, contract: string = MODEL_SLOTS[id].contract) => ({
  id, kind: 'onnx', version, path: `/data/onnx/${id}/${version}/${id}.onnx`, bytes: body.byteLength, sha256: createHash('sha256').update(body).digest('hex'), contract,
});

async function setup(files: Record<string, Uint8Array>, manifestAssets: unknown[], revision = 2, signWith?: CryptoKeyPair) {
  const trusted = await keypair();
  const values = new Map<string, string>();
  const blobs = new Map<string, Blob>();
  const store: ModelStoreLike = { get: async (k) => blobs.get(k), put: async (k, b) => { blobs.set(k, b); }, remove: async (k) => { blobs.delete(k); } };
  const calls: string[] = [];
  let current = { revision, assets: manifestAssets };
  let online = true;
  const make = async () => new ModelUpdater({
    baseUrl: BASE, keys: { k1: trusted.pub },
    storage: { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); } },
    store, now: () => Date.UTC(2026, 11, 1), online: () => online,
    fetch: (async (url: string) => {
      calls.push(url.replace(BASE, ''));
      if (url.endsWith('/manifest/stable.json')) return new Response(JSON.stringify(await sign(signWith ?? trusted.pair, { schema: 1, ...current })));
      const file = files[url.replace(BASE, '')];
      return file ? new Response(file as unknown as BodyInit) : new Response('no', { status: 404 });
    }) as unknown as typeof fetch,
  });
  return { updater: await make(), reload: make, calls, setFile: (path: string, body: Uint8Array) => { files[path] = body; }, blobs, setManifest: (revision: number, assets: unknown[]) => { current = { revision, assets }; }, setOnline: (v: boolean) => { online = v; } };
}

test('a signed same-contract update is downloaded, checked, kept and returned', async () => {
  const body = bytesOf('new yolox weights');
  const e = entry('yolox-tiny', '2026.12.1', body);
  const env = await setup({ [e.path]: body }, [e]);
  const outcome = await env.updater.check();
  assert.deepEqual(outcome, { kind: 'checked', installed: ['yolox-tiny'], skipped: [], rejected: [] });
  const found = await (await env.reload()).installed('yolox-tiny');
  assert.equal(Buffer.from(found!.bytes).toString(), 'new yolox weights');
  assert.equal(await env.updater.installed('u2netp'), null, 'nothing installed for other models: they stay bundled');
});

test('bytes that do not match the signed checksum are rejected and the previous model stays', async () => {
  const good = bytesOf('good weights'), bad = bytesOf('evil weights');
  const v1 = entry('u2netp', '1', good);
  const env = await setup({ [v1.path]: good }, [v1]);
  await env.updater.check();
  const v2 = entry('u2netp', '2', good);                      // the manifest promises `good`
  env.setManifest(3, [v2]);
  env.setFile(v2.path, bad);                                   // the server delivers something else
  const outcome = await env.updater.check(true);
  assert.equal(outcome.kind === 'checked' && outcome.rejected[0]?.reason, 'checksum_mismatch');
  assert.equal(Buffer.from((await env.updater.installed('u2netp'))!.bytes).toString(), 'good weights', 'the earlier install is untouched');
});

test('a manifest signed by another key, or an older revision, is refused', async () => {
  const body = bytesOf('weights');
  const e = entry('yolox-tiny', '1', body);
  const other = await keypair();
  const forged = await setup({ [e.path]: body }, [e], 2, other.pair);
  assert.deepEqual(await forged.updater.check(), { kind: 'refused', reason: 'untrusted_manifest' });
  assert.equal(await forged.updater.installed('yolox-tiny'), null);

  const env = await setup({ [e.path]: body }, [e], 5);
  await env.updater.check(true);
  env.setManifest(4, [entry('yolox-tiny', '0.9', bytesOf('old'))]);
  assert.deepEqual(await env.updater.check(true), { kind: 'refused', reason: 'older_revision' });
});

test('a model that changes its contract is reported, not installed', async () => {
  const body = bytesOf('weights');
  const e = entry('bioclip-image-int8', '2', body, 'bioclip-image-384/v2');
  const env = await setup({ [e.path]: body }, [e]);
  const outcome = await env.updater.check();
  assert.deepEqual(outcome.kind === 'checked' && outcome.skipped, [{ id: 'bioclip-image-int8', reason: 'contract_changed' }]);
  assert.equal(env.calls.some((c) => c.includes('/data/')), false, 'it is not even downloaded');
});

test('offline, or checked within a day, asks for nothing', async () => {
  const body = bytesOf('weights');
  const e = entry('yolox-tiny', '1', body);
  const env = await setup({ [e.path]: body }, [e]);
  env.setOnline(false);
  assert.deepEqual(await env.updater.check(), { kind: 'offline' });
  assert.equal(env.calls.length, 0);
  env.setOnline(true);
  await env.updater.check();
  const before = env.calls.length;
  assert.deepEqual(await (await env.reload()).check(), { kind: 'not_due' });
  assert.equal(env.calls.length, before);
});

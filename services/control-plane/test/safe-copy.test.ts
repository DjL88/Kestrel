import test from 'node:test';
import assert from 'node:assert/strict';
import { MemorySafeCopyCatalog, MemorySafeCopyStorage } from '../src/safeCopy.ts';
import { newLicence } from '../src/store.ts';
import { startHarness } from './helpers.ts';

const sha = (c: string) => c.repeat(64);
async function harness(quota = 10_000_000) {
  const storage = new MemorySafeCopyStorage(); const catalog = new MemorySafeCopyCatalog();
  const h = await startHarness(undefined, undefined, { safeCopy: { storage, catalog, bytesQuota: quota } });
  // A Cloud subscriber (plan 'subscriber') is entitled; the default test user is plain 'paid'.
  const id = await h.app.createAccount('cloud@example.test', 'cloud-password-123', 'user');
  await h.app.store.insertLicence(newLicence('lic-cloud-1', 'subscriber', h.clock.now, { accountId: id }));
  const token = (await h.app.issueSession(id, 'user')).accessToken;
  return { h, storage, catalog, id, token };
}
const up = (h: any, token: string, body: object) => h.call('POST', '/v1/safe-copy/upload-url', { token, body });
const on = (h: any, token: string, levels: object) => h.call('POST', '/v1/me/safe-copy', { token, body: { levels } });
const item = { level: 'previews', sha256: sha('a'), bytes: 2_000_000 };

test('off by default: nothing is uploaded until the person turns that level on, and originals are a separate switch', async () => {
  const { h, storage, token } = await harness();
  try {
    assert.deepEqual((await h.call('GET', '/v1/me/safe-copy', { token })).body.levels, { recipes: false, previews: false, originals: false });
    let r = await up(h, token, item);
    assert.equal(r.status, 403); assert.equal(r.body.error.code, 'SAFE_COPY_NOT_ENABLED');
    await on(h, token, { recipes: true, previews: true });
    assert.equal((await up(h, token, item)).status, 200);
    r = await up(h, token, { level: 'originals', sha256: sha('b'), bytes: 3_000_000 });
    assert.equal(r.status, 403, 'previews on does not turn originals on');
    assert.equal(storage.signedUploads, 1);
  } finally { await h.close(); }
});

test('gate: entitled plan, kill switch, size per level, valid hash, quota', async () => {
  const { h, storage, token, catalog, id } = await harness(5_000_000);
  try {
    await on(h, token, { recipes: true, previews: true, originals: true });
    assert.equal((await up(h, token, { ...item, sha256: 'xyz' })).status, 400);
    assert.equal((await up(h, token, { level: 'recipes', sha256: sha('c'), bytes: 9_000_000 })).status, 413);
    await h.app.store.setSetting('safe_copy_disabled', '1');
    const k = await up(h, token, item); assert.equal(k.status, 503); assert.equal(k.body.error.code, 'SAFE_COPY_DISABLED');
    await h.app.store.setSetting('safe_copy_disabled', '0');
    assert.equal((await up(h, token, item)).status, 200);
    assert.equal((await up(h, token, { level: 'previews', sha256: sha('d'), bytes: 2_000_000 })).status, 200);
    const over = await up(h, token, { level: 'previews', sha256: sha('e'), bytes: 2_000_000 });
    assert.equal(over.status, 429); assert.equal(over.body.error.code, 'SAFE_COPY_QUOTA_EXHAUSTED');
    assert.equal(storage.signedUploads, 2); assert.equal(await catalog.usage(id), 4_000_000);
    // A plain paid (not Cloud) account is refused.
    const plain = (await h.app.issueSession(h.user.accountId, 'user')).accessToken;
    await on(h, plain, { previews: true });
    const np = await up(h, plain, item); assert.equal(np.status, 403); assert.equal(np.body.error.code, 'SAFE_COPY_NOT_ENTITLED');
  } finally { await h.close(); }
});

test('upload keys are content-addressed per account: no file name, no account id in the key; same file twice costs once', async () => {
  const { h, storage, token, id } = await harness();
  try {
    await on(h, token, { previews: true });
    const a = await up(h, token, item); const b = await up(h, token, item);
    assert.equal(a.status, 200); assert.equal(b.status, 200); assert.equal(b.body.alreadyStored, false, 'not committed yet');
    const key = storage.lastKey!;
    assert.ok(key.endsWith(`/previews/${sha('a')}`)); assert.ok(!key.includes(id));
    assert.equal((await h.call('POST', '/v1/safe-copy/commit', { token, body: { level: 'previews', sha256: sha('a') } })).status, 200);
    const c = await up(h, token, item); assert.equal(c.body.alreadyStored, true); assert.equal(c.body.uploadUrl, undefined);
    assert.equal((await h.call('GET', '/v1/safe-copy/usage', { token })).body.bytesUsed, 2_000_000, 'counted once');
  } finally { await h.close(); }
});

test('after a lapse or kill switch the person can still read and delete their own copy, and nobody else can', async () => {
  const { h, storage, token } = await harness();
  try {
    await on(h, token, { previews: true });
    await up(h, token, item); await h.call('POST', '/v1/safe-copy/commit', { token, body: { level: 'previews', sha256: sha('a') } });
    await h.app.store.setSetting('safe_copy_disabled', '1');
    const dl = await h.call('POST', '/v1/safe-copy/download-url', { token, body: { level: 'previews', sha256: sha('a') } });
    assert.equal(dl.status, 200); assert.match(dl.body.downloadUrl, /^memory:\/\/download\//);
    const otherId = await h.app.createAccount('x@example.test', 'other-password-123', 'user');
    const other = (await h.app.issueSession(otherId, 'user')).accessToken;
    assert.equal((await h.call('POST', '/v1/safe-copy/download-url', { token: other, body: { level: 'previews', sha256: sha('a') } })).status, 404);
    const del = await h.call('POST', '/v1/safe-copy/delete', { token, body: { level: 'previews', sha256: sha('a') } });
    assert.equal(del.status, 200); assert.equal(storage.has(storage.lastKey!), false);
    assert.equal((await h.call('GET', '/v1/safe-copy/usage', { token })).body.bytesUsed, 0);
  } finally { await h.close(); }
});

test('not configured: 503 and nothing stored', async () => {
  const h = await startHarness();
  try { assert.equal((await h.call('POST', '/v1/safe-copy/upload-url', { token: h.user.token, body: item })).status, 503); } finally { await h.close(); }
});

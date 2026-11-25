import test from 'node:test';
import assert from 'node:assert/strict';
import { CollabStore } from '../src/collaboration.ts';
import { CloudPhotoStore } from '../src/cloudPhotos.ts';
import { FlatAllowance, MemoryUsageMeter, millicreditsForBytes } from '../src/usageMeter.ts';
import { MemorySafeCopyStorage } from '../src/safeCopy.ts';
import { newLicence } from '../src/store.ts';
import { MemoryFirestore } from './memoryFirestore.ts';
import { startHarness } from './helpers.ts';

const sha = (c: string) => c.repeat(64);
const KEY = `o_${'a'.repeat(64)}`;

async function harness(allowanceCredits = 1, maxProjectBytes = 50_000_000, cloudBalance?: import('../src/cloudBalance.ts').CloudBalance) {
  const db = new MemoryFirestore();
  const storage = new MemorySafeCopyStorage();
  const meter = new MemoryUsageMeter();
  const h = await startHarness(undefined, undefined, {
    collab: new CollabStore(db),
    cloudPhotos: { store: new CloudPhotoStore(db, storage), meter, allowance: new FlatAllowance(allowanceCredits * 1000), maxProjectBytes },
    cloudBalance,
  });
  const person = async (email: string, plan?: 'subscriber') => {
    const id = await h.app.createAccount(email, 'a-long-password-123', 'user');
    if (plan) await h.app.store.insertLicence(newLicence(`lic-${id}`, plan, h.clock.now, { accountId: id }));
    return { id, token: (await h.app.issueSession(id, 'user')).accessToken };
  };
  const owner = await person('owner@example.test', 'subscriber');
  const friend = await person('friend@example.test');
  const viewer = await person('viewer@example.test');
  const call = (method: string, path: string, token: string, body?: object) => h.call(method, path, { token, body });
  const pid = (await call('POST', '/v1/collab/projects', owner.token, { name: 'Kites', displayName: 'Dave' })).body.projectId as string;
  const P = `/v1/collab/projects/${pid}`;
  await call('POST', `${P}/members`, owner.token, { kind: 'inviteEmail', email: 'friend@example.test', role: 'editor', displayName: 'Fi' });
  await call('POST', `${P}/members`, owner.token, { kind: 'inviteEmail', email: 'viewer@example.test', role: 'viewer', displayName: 'Vi' });
  await call('POST', `${P}/accept`, friend.token, { displayName: 'Fi' });
  await call('POST', `${P}/accept`, viewer.token, { displayName: 'Vi' });
  return { h, owner, friend, viewer, call, P, meter, storage };
}

async function put(ctx: Awaited<ReturnType<typeof harness>>, variant: string, bytes: number, c = 'b', key = KEY) {
  const r = await ctx.call('POST', `${ctx.P}/photos/${key}/cloud/upload-url`, ctx.owner.token, { variant, sha256: sha(c), bytes, name: 'Kite.NEF' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await ctx.call('POST', `${ctx.P}/photos/${key}/cloud/commit`, ctx.owner.token, { variant })).status, 200);
  return r.body;
}

test('cloud photos answer 503 until set up', async () => {
  const bare = await startHarness(undefined, undefined, { collab: new CollabStore(new MemoryFirestore()) });
  try { assert.equal((await bare.call('GET', '/v1/me/usage', { token: bare.user.token })).body.error.code, 'CLOUD_NOT_CONFIGURED'); } finally { await bare.close(); }
});

test('previews go up, friends list and download them, and every download is counted against the owner', async () => {
  const ctx = await harness(1);
  try {
    await put(ctx, 'thumb', 30_000);
    await put(ctx, 'preview', 600_000);
    assert.equal((await put(ctx, 'preview', 600_000)).alreadyStored, true, 'the same preview is never uploaded twice');
    let r = await ctx.call('GET', `${ctx.P}/cloud`, ctx.friend.token);
    assert.deepEqual(r.body.photos, [{ photoKey: KEY, name: 'Kite.NEF', previewBytes: 600_000, thumbBytes: 30_000, originalBytes: null }]);
    r = await ctx.call('POST', `${ctx.P}/photos/${KEY}/cloud/download-url`, ctx.friend.token, { variant: 'preview' });
    assert.equal(r.status, 200);
    assert.match(r.body.downloadUrl, /^memory:\/\/download\/projects\/[0-9a-f]{32}\/o_a+\/preview\.jpg$/);
    assert.equal(r.body.millicredits, millicreditsForBytes(600_000));
    assert.equal((await ctx.meter.usage(ctx.owner.id, ctx.h.clock.now)).bytes, 600_000, "the friend's download is on the owner's meter");
    assert.equal((await ctx.meter.usage(ctx.friend.id, ctx.h.clock.now)).bytes, 0);
    r = await ctx.call('POST', `${ctx.P}/photos/${KEY}/cloud/download-url`, ctx.friend.token, { variant: 'original' });
    assert.equal(r.status, 404, 'no original until the owner stores one');
    r = await ctx.call('GET', '/v1/me/usage', ctx.owner.token);
    assert.equal(r.body.allowanceCredits, 1); assert.equal(r.body.downloads, 1); assert.equal(r.body.plan, 'pro', 'the owner holds a subscriber licence');
  } finally { await ctx.h.close(); }
});

test('originals: only exporters download them, and the allowance stops downloads when used up', async () => {
  const ctx = await harness(2, 1_000_000_000);
  try {
    await put(ctx, 'preview', 400_000);
    await put(ctx, 'original', 60_000_000, 'c');
    assert.equal((await ctx.call('POST', `${ctx.P}/photos/${KEY}/cloud/download-url`, ctx.viewer.token, { variant: 'original' })).status, 403, 'a viewer cannot take the original');
    assert.equal((await ctx.call('POST', `${ctx.P}/photos/${KEY}/cloud/download-url`, ctx.viewer.token, { variant: 'preview' })).status, 200);
    let r = await ctx.call('POST', `${ctx.P}/photos/${KEY}/cloud/download-url`, ctx.friend.token, { variant: 'original' });
    assert.equal(r.status, 200, JSON.stringify(r.body)); // 60 MB at 33 credits per GB = 1.98 credits
    r = await ctx.call('POST', `${ctx.P}/photos/${KEY}/cloud/download-url`, ctx.friend.token, { variant: 'original' });
    assert.equal(r.status, 402); assert.equal(r.body.error.code, 'CREDITS_EXHAUSTED');
    assert.equal((await ctx.call('POST', `${ctx.P}/photos/${KEY}/cloud/upload-url`, ctx.viewer.token, { variant: 'preview', sha256: sha('d'), bytes: 10, name: 'x' })).status, 403, 'viewers do not upload');
  } finally { await ctx.h.close(); }
});

test('the project store has a size cap and removing a photo deletes its files', async () => {
  const ctx = await harness(1, 1_000_000);
  try {
    await put(ctx, 'preview', 900_000);
    const r = await ctx.call('POST', `${ctx.P}/photos/${KEY}/cloud/upload-url`, ctx.owner.token, { variant: 'thumb', sha256: sha('e'), bytes: 150_000, name: 'Kite.NEF' });
    assert.equal(r.status, 507); assert.equal(r.body.error.code, 'CLOUD_FULL');
    assert.equal((await ctx.call('POST', `${ctx.P}/photos/${KEY}/cloud/upload-url`, ctx.owner.token, { variant: 'thumb', sha256: sha('e'), bytes: 300_000, name: 'x' })).status, 413);
    assert.equal((await ctx.call('POST', `${ctx.P}/photos/${KEY}/cloud/remove`, ctx.owner.token, {})).status, 200);
    assert.deepEqual((await ctx.call('GET', `${ctx.P}/cloud`, ctx.owner.token)).body.photos, []);
  } finally { await ctx.h.close(); }
});

test('storage beyond the free 2.5 GB needs a month of it in the balance, and is charged once a day', async () => {
  const { MemoryCloudBalance } = await import('../src/cloudBalance.ts');
  const balance = new MemoryCloudBalance();
  const ctx = await harness(1, 10_000_000_000, balance);
  const key = (n: number) => `o_${String(n).repeat(64).slice(0, 64)}`;
  try {
    for (let n = 1; n <= 5; n++) await put(ctx, 'original', 500_000_000, String(n), key(n)); // 2.5 GB: all free
    let r = await ctx.call('POST', `${ctx.P}/photos/${key(6)}/cloud/upload-url`, ctx.owner.token, { variant: 'original', sha256: sha('6'), bytes: 500_000_000, name: 'x' });
    assert.equal(r.status, 402); assert.equal(r.body.error.code, 'STORAGE_NEEDS_CREDIT');
    await balance.credit(ctx.owner.id, 100_000, 'topup:1'); // £1
    await put(ctx, 'original', 500_000_000, '6', key(6)); // 0.5 GB over: 3.5p a month
    r = await ctx.call('GET', '/v1/me/usage', ctx.owner.token);
    assert.equal(r.body.storedBytes, 3_000_000_000);
    assert.equal(r.body.balanceCredits, (100_000 - 117) / 1000, "today's 0.5 GB (0.117 credits) is charged once");
    r = await ctx.call('POST', '/v1/admin/cloud-storage/settle', ctx.h.adminToken);
    assert.equal(r.status, 200); assert.equal(await balance.millicredits(ctx.owner.id), 100_000 - 117, 'repeating the day charges nothing more');
    ctx.h.clock.now += 86_400_000;
    const adminToken = (await ctx.h.app.issueSession(await ctx.h.app.createAccount('admin2@example.test', 'admin-password-123', 'admin'), 'admin')).accessToken; // the first session has expired
    r = await ctx.call('POST', '/v1/admin/cloud-storage/settle', adminToken);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await balance.millicredits(ctx.owner.id), 100_000 - 234, 'the next day is charged');
    const friendToken = (await ctx.h.app.issueSession(ctx.friend.id, 'user')).accessToken;
    assert.equal((await ctx.call('GET', '/v1/me/usage', friendToken)).body.storedBytes, 0, "an editor does not pay for the owner's project");
  } finally { await ctx.h.close(); }
});

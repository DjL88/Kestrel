import test from 'node:test';
import assert from 'node:assert/strict';
import { CollabStore } from '../src/collaboration.ts';
import { CloudPhotoStore } from '../src/cloudPhotos.ts';
import { GalleryStore } from '../src/gallery.ts';
import { MemoryCloudBalance } from '../src/cloudBalance.ts';
import { FlatAllowance, MemoryUsageMeter } from '../src/usageMeter.ts';
import { MemorySafeCopyStorage } from '../src/safeCopy.ts';
import { MAX_CATCH_UP_DAYS, daysToSettle } from '../src/cloudStorageBilling.ts';
import { newLicence } from '../src/store.ts';
import { MemoryFirestore } from './memoryFirestore.ts';
import { startHarness } from './helpers.ts';

const DAY = 86_400_000;
const sha = (c: string) => c.repeat(64);
const key = (n: number) => `o_${String(n).repeat(64).slice(0, 64)}`;

/** Cloud photos and client galleries on one server, as in production (they share the UK bucket). */
async function harness(plan?: 'subscriber') {
  const db = new MemoryFirestore();
  const storage = new MemorySafeCopyStorage();
  const balance = new MemoryCloudBalance();
  const h = await startHarness(undefined, undefined, {
    collab: new CollabStore(db), gallery: new GalleryStore(db, storage), cloudBalance: balance,
    cloudPhotos: { store: new CloudPhotoStore(db, storage), meter: new MemoryUsageMeter(), allowance: new FlatAllowance(1000), maxProjectBytes: 50_000_000_000 },
  });
  const id = await h.app.createAccount('owner@example.test', 'a-long-password-123', 'user');
  if (plan) await h.app.store.insertLicence(newLicence('lic-o', plan, h.clock.now, { accountId: id }));
  const token = () => h.app.issueSession(id, 'user').then((s) => s.accessToken);
  const call = async (method: string, path: string, body?: object) => h.call(method, path, { token: await token(), body });
  const pid = (await call('POST', '/v1/collab/projects', { name: 'Raptors', displayName: 'Dave' })).body.projectId as string;
  const putPhoto = async (n: number, bytes: number) => {
    const r = await call('POST', `/v1/collab/projects/${pid}/photos/${key(n)}/cloud/upload-url`, { variant: 'original', sha256: sha(String(n)), bytes, name: 'Kite.NEF' });
    if (r.status !== 200) return r;
    return call('POST', `/v1/collab/projects/${pid}/photos/${key(n)}/cloud/commit`, { variant: 'original' });
  };
  return { h, id, balance, call, pid, putPhoto };
}

test('days to settle: today first time, every missed day after that, at most two months', () => {
  const now = Date.parse('2026-11-27T15:00:00Z');
  assert.deepEqual(daysToSettle(undefined, now), ['2026-11-27']);
  assert.deepEqual(daysToSettle('garbage', now), ['2026-11-27']);
  assert.deepEqual(daysToSettle('2026-11-27', now), [], 'already settled today');
  assert.deepEqual(daysToSettle('2026-11-24', now), ['2026-11-25', '2026-11-26', '2026-11-27']);
  assert.equal(daysToSettle('2025-01-01', now).length, MAX_CATCH_UP_DAYS);
  assert.equal(daysToSettle('2025-01-01', now).at(-1), '2026-11-27');
});

test('client-gallery previews count towards the same 2.5 GB as cloud photos, and an expired gallery stops counting', async () => {
  const ctx = await harness('subscriber');
  try {
    for (let n = 1; n <= 4; n++) assert.equal((await ctx.putPhoto(n, 500_000_000)).status, 200); // 2.0 GB of photos
    const made = await ctx.call('POST', `/v1/collab/projects/${ctx.pid}/galleries`, { name: 'Selects', photoIds: ['p1', 'p2'], days: 14 });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const G = `/v1/collab/galleries/${made.body.galleryId}/photos`;
    const first = await ctx.call('POST', `${G}/p1/upload-url`, { sha256: sha('a'), bytes: 5_000_000 });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal((await ctx.call('POST', `${G}/p1/commit`)).status, 200);
    assert.equal((await ctx.call('GET', '/v1/me/usage')).body.storedBytes, 2_005_000_000, 'the gallery preview is counted');
    assert.equal((await ctx.putPhoto(5, 495_000_000)).status, 200, 'exactly 2.5 GB is still included');
    // One more gallery preview would pass 2.5 GB with no balance: refused with the code the app shows as "storage is full".
    const over = await ctx.call('POST', `${G}/p2/upload-url`, { sha256: sha('b'), bytes: 1_000_000 });
    assert.equal(over.status, 402);
    assert.equal(over.body.error.code, 'STORAGE_NEEDS_CREDIT');
    ctx.h.clock.now += 15 * DAY; // the gallery has expired, so its previews no longer count
    assert.equal((await ctx.call('GET', '/v1/me/usage')).body.storedBytes, 2_495_000_000, 'only the photos remain');
  } finally { await ctx.h.close(); }
});

test('days nobody looked at are charged the next time the account is seen, once each', async () => {
  const ctx = await harness('subscriber');
  try {
    await ctx.balance.credit(ctx.id, 100_000, 'topup:1'); // £1
    for (let n = 1; n <= 6; n++) assert.equal((await ctx.putPhoto(n, 500_000_000)).status, 200); // 3 GB: 0.5 GB over
    await ctx.call('GET', '/v1/me/usage');
    const afterToday = await ctx.balance.millicredits(ctx.id);
    assert.equal(afterToday, 100_000 - 117, 'today: 0.5 GB at 7p a GB-month is 0.117p');
    ctx.h.clock.now += 3 * DAY; // no scheduler ran
    await ctx.call('GET', '/v1/me/usage');
    assert.equal(await ctx.balance.millicredits(ctx.id), afterToday - 3 * 117, 'the three missed days');
    await ctx.call('GET', '/v1/me/usage');
    assert.equal(await ctx.balance.millicredits(ctx.id), afterToday - 3 * 117, 'looking again charges nothing more');
  } finally { await ctx.h.close(); }
});

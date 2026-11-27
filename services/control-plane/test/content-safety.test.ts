import test from 'node:test';
import assert from 'node:assert/strict';
import { CollabStore } from '../src/collaboration.ts';
import { GalleryStore, previewKey } from '../src/gallery.ts';
import { CloudPhotoStore, cloudKey } from '../src/cloudPhotos.ts';
import { FlatAllowance, MemoryUsageMeter } from '../src/usageMeter.ts';
import { MemorySafeCopyStorage } from '../src/safeCopy.ts';
import { newLicence } from '../src/store.ts';
import { SafetyService } from '../src/contentSafety.ts';
import { MemoryFirestore } from './memoryFirestore.ts';
import { startHarness } from './helpers.ts';

// InFlight does not scan photos (removed 27 November 2026): sharing publishes without any image check, and the
// report-a-gallery queue is how illegal or policy-breaking content reaches a person.
const CLEAN = Buffer.from('synthetic picture of a kestrel');
const sha = 'a'.repeat(64);

async function harness(opts: { requireAdminSwitch?: boolean } = {}) {
  const db = new MemoryFirestore();
  const storage = new MemorySafeCopyStorage();
  const service = new SafetyService(db);
  const h = await startHarness(undefined, undefined, {
    collab: new CollabStore(db), gallery: new GalleryStore(db, storage),
    cloudPhotos: { store: new CloudPhotoStore(db, storage), meter: new MemoryUsageMeter(), allowance: new FlatAllowance(1000), maxProjectBytes: 50_000_000 },
    safety: { service }, requireAdminSwitch: opts.requireAdminSwitch,
  });
  if (opts.requireAdminSwitch) await h.app.store.setSetting('switch_collaboration', '1');
  const id = await h.app.createAccount('owner@example.test', 'a-long-password-123', 'user');
  await h.app.store.insertLicence(newLicence('lic-o', 'subscriber', h.clock.now, { accountId: id }));
  const token = (await h.app.issueSession(id, 'user')).accessToken;
  const post = (path: string, body?: object, t: string | undefined = token) => h.call('POST', path, { token: t, body });
  const pid = (await post('/v1/collab/projects', { name: 'Raptors', displayName: 'Dave' })).body.projectId as string;
  const admin = (method: string, path: string, body?: object) => h.call(method, path, { token: h.adminToken, body });
  return { h, db, storage, service, id, token, post, pid, admin };
}
type Ctx = Awaited<ReturnType<typeof harness>>;

async function gallery(ctx: Ctx) {
  const made = await ctx.post(`/v1/collab/projects/${ctx.pid}/galleries`, { name: 'Selects', photoIds: ['p1', 'p2'] });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  return made.body as { galleryId: string; linkToken: string };
}
async function publish(ctx: Ctx, galleryId: string, photoId: string, bytes: Buffer) {
  assert.equal((await ctx.post(`/v1/collab/galleries/${galleryId}/photos/${photoId}/upload-url`, { sha256: sha, bytes: bytes.length })).status, 200);
  ctx.storage.put(previewKey(galleryId, photoId), bytes);
  return ctx.post(`/v1/collab/galleries/${galleryId}/photos/${photoId}/commit`);
}

test('production publishes gallery and cloud pictures without any image scan, and keeps no safety cases', async () => {
  const ctx = await harness({ requireAdminSwitch: true });
  try {
    const { galleryId } = await gallery(ctx);
    const published = await publish(ctx, galleryId, 'p1', CLEAN);
    assert.equal(published.status, 200, JSON.stringify(published.body));
    ctx.storage.put(cloudKey(ctx.pid, 'p2', 'original'), CLEAN);
    const stored = await ctx.post(`/v1/collab/projects/${ctx.pid}/photos/p2/cloud/commit`, { variant: 'original' });
    assert.notEqual(stored.body.error?.code ?? stored.body.code, 'PREVIEW_FIRST', 'an original no longer waits for a checked preview');
    const listed = await ctx.admin('GET', '/v1/admin/safety');
    assert.equal(listed.status, 200);
    assert.equal('cases' in listed.body, false);
    assert.equal((await ctx.admin('POST', '/v1/admin/safety/cases/case_x/report')).status, 404, 'the CyberTipline route is gone');
  } finally { await ctx.h.close(); }
});

test('report a gallery: anyone can report, a child-abuse report takes it down at once, and both sides hear the reason', async () => {
  const ctx = await harness();
  try {
    const { galleryId, linkToken } = await gallery(ctx);
    assert.equal((await publish(ctx, galleryId, 'p1', CLEAN)).status, 200);
    const report = (body: object) => ctx.h.call('POST', '/v1/gallery/report', { body: { token: linkToken, ...body } });
    assert.equal((await report({ category: 'copyright', explanation: 'This is my photograph, used without permission.' })).status, 400, 'good faith statement required');
    assert.equal((await report({ category: 'copyright', explanation: 'short', goodFaith: true })).status, 400, 'an explanation is required');
    const made = await report({ photoId: 'p1', category: 'child-sexual-abuse', explanation: 'This photo shows a child being abused.', goodFaith: true });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    assert.equal(made.body.urgent, true);
    assert.equal((await ctx.h.call('POST', '/v1/gallery/open', { body: { token: linkToken } })).status, 451, 'taken down while reviewed');
    const status = (receipt: string) => ctx.h.call('POST', '/v1/gallery/report/status', { body: { noticeId: made.body.noticeId, receipt } });
    assert.equal((await status('x'.repeat(24))).status, 404, 'needs the receipt');
    assert.equal((await status(made.body.receipt)).body.status, 'open');

    const listed = await ctx.admin('GET', '/v1/admin/safety');
    assert.equal(listed.body.notices[0].noticeId, made.body.noticeId);
    assert.equal('receiptHash' in listed.body.notices[0], false);
    assert.equal((await ctx.admin('POST', `/v1/admin/safety/notices/${made.body.noticeId}/decide`, { outcome: 'photo-removed', reason: 'Removed as a precaution under section 1 of the acceptable use policy.' })).status, 200);
    const open = await ctx.h.call('POST', '/v1/gallery/open', { body: { token: linkToken } });
    assert.equal(open.status, 200, 'the rest of the gallery is back');
    assert.equal(open.body.photos.length, 0);
    assert.equal(ctx.storage.has(previewKey(galleryId, 'p1')), false);
    const after = (await status(made.body.receipt)).body;
    assert.equal(after.outcome, 'photo-removed');
    assert.match(after.reason, /acceptable use policy/);
    const mine = await ctx.h.call('GET', '/v1/me/safety', { token: ctx.token });
    assert.equal(mine.body.actions[0].outcome, 'photo-removed', 'the gallery owner sees what was done and why');
  } finally { await ctx.h.close(); }
});

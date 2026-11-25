import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CollabStore } from '../src/collaboration.ts';
import { GalleryStore, previewKey } from '../src/gallery.ts';
import { CloudPhotoStore, cloudKey } from '../src/cloudPhotos.ts';
import { FlatAllowance, MemoryUsageMeter } from '../src/usageMeter.ts';
import { MemorySafeCopyStorage } from '../src/safeCopy.ts';
import { newLicence } from '../src/store.ts';
import {
  SafetyService, ExactHashListMatcher, PhotoDnaMatcher, NcmecCyberTipline, safeSearchVerdict,
  type SafetyClassifier, type CyberTipReporter, type HashMatcher, type SafetyCase,
} from '../src/contentSafety.ts';
import { MemoryFirestore } from './memoryFirestore.ts';
import { startHarness } from './helpers.ts';

// A stand-in for a provider's test image: its MD5 is on the test hash list. No real abuse material is involved anywhere.
const KNOWN = Buffer.from('synthetic test image on the provider test hash list');
const FLAGGED = Buffer.from('synthetic picture the fake classifier flags');
const CLEAN = Buffer.from('synthetic picture of a kestrel');
const md5 = (b: Buffer) => createHash('md5').update(b).digest('hex');
const sha = 'a'.repeat(64);

function fakeClassifier(): SafetyClassifier & { calls: number } {
  return { name: 'fake-safesearch', calls: 0, async classify(image) { this.calls++; return image.equals(FLAGGED) ? safeSearchVerdict({ adult: 'VERY_LIKELY', racy: 'LIKELY' }) : safeSearchVerdict({ adult: 'VERY_UNLIKELY' }); } };
}
function fakeReporter(): CyberTipReporter & { sent: { c: SafetyCase; evidence: Buffer }[] } {
  return { sent: [], async submit(c, evidence) { this.sent.push({ c, evidence }); return { reportId: `TEST-${this.sent.length}` }; } };
}

async function harness(opts: { matchers?: HashMatcher[]; requireAdminSwitch?: boolean; noSafety?: boolean } = {}) {
  const db = new MemoryFirestore();
  const storage = new MemorySafeCopyStorage();
  const classifier = fakeClassifier();
  const reporter = fakeReporter();
  const service = new SafetyService(db, { hashMatchers: opts.matchers ?? [new ExactHashListMatcher([md5(KNOWN)], 'provider-test-set')], classifier, reporter });
  const h = await startHarness(undefined, undefined, {
    collab: new CollabStore(db), gallery: new GalleryStore(db, storage),
    cloudPhotos: { store: new CloudPhotoStore(db, storage), meter: new MemoryUsageMeter(), allowance: new FlatAllowance(1000), maxProjectBytes: 50_000_000 },
    safety: opts.noSafety ? undefined : { service, countryOf: () => 'GB' }, requireAdminSwitch: opts.requireAdminSwitch,
  });
  if (opts.requireAdminSwitch) await h.app.store.setSetting('switch_collaboration', '1');
  const id = await h.app.createAccount('owner@example.test', 'a-long-password-123', 'user');
  await h.app.store.insertLicence(newLicence('lic-o', 'subscriber', h.clock.now, { accountId: id }));
  const token = (await h.app.issueSession(id, 'user')).accessToken;
  const post = (path: string, body?: object, t: string | undefined = token) => h.call('POST', path, { token: t, body });
  const pid = (await post('/v1/collab/projects', { name: 'Raptors', displayName: 'Dave' })).body.projectId as string;
  const admin = (method: string, path: string, body?: object) => h.call(method, path, { token: h.adminToken, body });
  return { h, db, storage, classifier, reporter, service, id, token, post, pid, admin };
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

test('a known-hash test image is blocked, kept as evidence, reported, and its account suspended, without anyone viewing it', async () => {
  const ctx = await harness();
  try {
    const { galleryId, linkToken } = await gallery(ctx);
    const r = await publish(ctx, galleryId, 'p1', KNOWN);
    assert.equal(r.status, 403);
    assert.equal(r.body.error?.code ?? r.body.code, 'CONTENT_BLOCKED');
    assert.equal(ctx.storage.has(previewKey(galleryId, 'p1')), false, 'the shared copy is gone');
    assert.equal(ctx.reporter.sent.length, 1, 'reported to the CyberTipline');
    assert.ok(ctx.reporter.sent[0]!.evidence.equals(KNOWN), 'the report carries the preserved bytes');
    const c = ctx.reporter.sent[0]!.c;
    assert.equal(ctx.storage.has(c.evidenceKey!), true, 'evidence kept');
    assert.ok(c.preserveUntilMs! - c.atMs >= 365 * 86_400_000, 'kept for a year');
    assert.equal(c.nca, 'manual', 'a UK upload is also marked for the NCA');
    assert.equal((await ctx.h.call('GET', '/v1/collab/projects', { token: ctx.token })).status, 401, 'account suspended');
    assert.equal((await ctx.h.call('POST', '/v1/gallery/open', { body: { token: linkToken } })).status, 451, 'the gallery is taken down');

    const view = await ctx.admin('GET', '/v1/admin/safety');
    assert.equal(view.status, 200);
    const listed = view.body.cases[0];
    assert.equal(listed.status, 'reported');
    assert.equal(listed.ncmec.reportId, 'TEST-1');
    const text = JSON.stringify(view.body);
    for (const leak of ['evidence/', 'memory://', 'galleries/', 'base64']) assert.equal(text.includes(leak), false, `admin view must not expose ${leak}`);
    assert.equal((await ctx.admin('POST', `/v1/admin/safety/cases/${listed.caseId}/decide`, { outcome: 'released', reason: 'try' })).status, 409, 'a hash match cannot be released');
    assert.equal(ctx.classifier.calls, 0, 'the AI check never ran: the hash list decided');
  } finally { await ctx.h.close(); }
});

test('an AI flag holds the picture for review, never reports it, and a person can release it from the details only', async () => {
  const ctx = await harness();
  try {
    const { galleryId, linkToken } = await gallery(ctx);
    const held = await publish(ctx, galleryId, 'p1', FLAGGED);
    assert.equal(held.status, 409);
    assert.equal((await ctx.h.call('POST', '/v1/gallery/open', { body: { token: linkToken } })).body.photos.length, 0, 'not visible to the client');
    assert.equal(ctx.reporter.sent.length, 0, 'never reported automatically');
    assert.equal((await ctx.h.call('GET', '/v1/collab/projects', { token: ctx.token })).status, 200, 'nobody is suspended for an AI flag');
    assert.equal((await ctx.post(`/v1/collab/galleries/${galleryId}/photos/p1/commit`)).status, 409, 'trying again stays held');
    const mine = await ctx.h.call('GET', '/v1/me/safety', { token: ctx.token });
    assert.equal(mine.body.cases.length, 1, 'no second case for the same picture');
    assert.match(mine.body.cases[0].statement, /automated classifier \(adult very likely/);
    assert.match(mine.body.cases[0].statement, /Not reported/);

    const caseId = mine.body.cases[0].caseId;
    assert.equal((await ctx.admin('POST', `/v1/admin/safety/cases/${caseId}/report`)).status, 409, 'AI flags are not reportable');
    assert.equal((await ctx.admin('POST', `/v1/admin/safety/cases/${caseId}/decide`, { outcome: 'upheld', reason: 'Explicit, per the photographer\'s description.' })).status, 200);
    assert.equal((await ctx.h.call('POST', `/v1/me/safety/${caseId}/appeal`, { token: ctx.token, body: { text: 'It is a classical sculpture.' } })).status, 200);
    assert.equal((await ctx.admin('POST', `/v1/admin/safety/cases/${caseId}/decide`, { outcome: 'released', reason: 'Sculpture, fine.' })).status, 200);
    assert.equal((await ctx.post(`/v1/collab/galleries/${galleryId}/photos/p1/commit`)).status, 200, 'released pictures publish');
    assert.equal((await ctx.h.call('POST', '/v1/gallery/open', { body: { token: linkToken } })).body.photos.length, 1);
  } finally { await ctx.h.close(); }
});

test('clean pictures publish; a checker that cannot answer fails closed', async () => {
  const broken: HashMatcher = { name: 'down', maxBytes: 4_000_000, match: async () => { throw new Error('offline'); } };
  const ok = await harness();
  const down = await harness({ matchers: [broken] });
  try {
    const g = await gallery(ok);
    assert.equal((await publish(ok, g.galleryId, 'p1', CLEAN)).status, 200);
    const g2 = await gallery(down);
    const r = await publish(down, g2.galleryId, 'p1', CLEAN);
    assert.equal(r.status, 503);
    assert.equal((await down.h.call('POST', '/v1/gallery/open', { body: { token: g2.linkToken } })).body.photos.length, 0);
  } finally { await ok.h.close(); await down.h.close(); }
});

test('production refuses to publish when no hash check is set up; development keeps working', async () => {
  const prod = await harness({ requireAdminSwitch: true, noSafety: true });
  const dev = await harness({ noSafety: true });
  try {
    const g = await gallery(prod);
    const r = await publish(prod, g.galleryId, 'p1', CLEAN);
    assert.equal(r.status, 503);
    assert.match(JSON.stringify(r.body), /SAFETY_NOT_CONFIGURED/);
    const g2 = await gallery(dev);
    assert.equal((await publish(dev, g2.galleryId, 'p1', CLEAN)).status, 200);
  } finally { await prod.h.close(); await dev.h.close(); }
});

test('cloud store: previews are checked; an original only follows a preview that passed', async () => {
  const ctx = await harness();
  try {
    const P = `/v1/collab/projects/${ctx.pid}`;
    const key = `o_${'c'.repeat(64)}`;
    const up = (variant: string, bytes: Buffer) => ctx.post(`${P}/photos/${key}/cloud/upload-url`, { variant, sha256: sha, bytes: bytes.length, name: 'Kite.NEF' });
    assert.equal((await up('original', CLEAN)).status, 200);
    ctx.storage.put(cloudKey(ctx.pid, key, 'original'), CLEAN);
    assert.equal((await ctx.post(`${P}/photos/${key}/cloud/commit`, { variant: 'original' })).status, 409, 'preview first');
    assert.equal((await up('preview', FLAGGED)).status, 200);
    ctx.storage.put(cloudKey(ctx.pid, key, 'preview'), FLAGGED);
    assert.equal((await ctx.post(`${P}/photos/${key}/cloud/commit`, { variant: 'preview' })).status, 409, 'held');
    assert.equal((await ctx.h.call('GET', `${P}/cloud`, { token: ctx.token })).body.photos.length, 0, 'friends see nothing held');
    ctx.storage.put(cloudKey(ctx.pid, key, 'preview'), CLEAN);
    assert.equal((await ctx.post(`${P}/photos/${key}/cloud/commit`, { variant: 'preview' })).status, 200, 'a different, clean picture passes');
    assert.equal((await ctx.post(`${P}/photos/${key}/cloud/commit`, { variant: 'original' })).status, 200);
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

test('checkers: SafeSearch never flags racy alone; PhotoDNA and the CyberTipline client speak their APIs', async () => {
  assert.equal(safeSearchVerdict({ adult: 'POSSIBLE', racy: 'VERY_LIKELY', violence: 'LIKELY' }).flagged, false);
  assert.equal(safeSearchVerdict({ adult: 'LIKELY' }).flagged, true);
  assert.equal(safeSearchVerdict({ violence: 'VERY_LIKELY' }).flagged, true);
  const list = new ExactHashListMatcher([md5(KNOWN).toUpperCase(), 'not a hash']);
  assert.equal(list.size, 1);
  assert.equal((await list.match(KNOWN)).matched, true);
  assert.equal((await list.match(CLEAN)).matched, false);

  const seen: { url: string; headers: Record<string, string> }[] = [];
  const pdna = new PhotoDnaMatcher('key-1', (async (url: string, init: RequestInit) => {
    seen.push({ url, headers: init.headers as Record<string, string> });
    return new Response(JSON.stringify({ Status: { Code: 3000 }, IsMatch: true, TrackingId: 'T1', MatchDetails: { MatchFlags: [{ Source: 'Test' }] } }));
  }) as typeof fetch);
  assert.deepEqual(await pdna.match(KNOWN), { matched: true, source: 'photodna:Test', matchId: 'T1' });
  assert.equal(seen[0]!.headers['ocp-apim-subscription-key'], 'key-1');
  const pdnaDown = new PhotoDnaMatcher('k', (async () => new Response(JSON.stringify({ Status: { Code: 3208 } }))) as unknown as typeof fetch);
  await assert.rejects(pdnaDown.match(KNOWN));

  const paths: string[] = [];
  const ok = (extra = '') => new Response(`<reportResponse><responseCode>0</responseCode><responseDescription>Success</responseDescription>${extra}</reportResponse>`);
  const tip = new NcmecCyberTipline({ username: 'u', password: 'p', reporterEmail: 'safety@example.test', companyName: 'Example' }, (async (url: string) => {
    paths.push(new URL(url).pathname);
    return url.endsWith('/submit') ? ok('<reportId>4242</reportId>') : ok();
  }) as typeof fetch);
  const c = { caseId: 'case_x', atMs: Date.UTC(2026, 10, 25), accountId: 'acc_<x>', country: 'GB' } as SafetyCase;
  assert.deepEqual(await tip.submit(c, KNOWN), { reportId: '4242' });
  assert.deepEqual(paths, ['/ispws/submit', '/ispws/upload', '/ispws/finish'], 'test environment by default');
});

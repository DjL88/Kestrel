import test from 'node:test';
import assert from 'node:assert/strict';
import { accountErasure, DELETION_GRACE_MS } from '../src/accountErasure.ts';
import { MemoryCloudBalance } from '../src/cloudBalance.ts';
import { CloudPhotoStore, cloudKey } from '../src/cloudPhotos.ts';
import { CollabStore } from '../src/collaboration.ts';
import { NoticeContacts } from '../src/noticeContacts.ts';
import { NoticeStore } from '../src/notices.ts';
import { PushService } from '../src/push.ts';
import { MemorySafeCopyStorage } from '../src/safeCopy.ts';
import { newLicence } from '../src/store.ts';
import { sha256Hex } from '../src/crypto.ts';
import { MemoryFirestore } from './memoryFirestore.ts';
import { startHarness } from './helpers.ts';

/** Ann owns "Kites" (Bob is in it, one cloud photo) and comments in Bob's "Raptors". She has Pro, a phone and a purchase. */
async function rig(opts: { safeCopyBytes?: number } = {}) {
  const db = new MemoryFirestore();
  const storage = new MemorySafeCopyStorage();
  const collab = new CollabStore(db);
  const cloud = new CloudPhotoStore(db, storage);
  const push = new PushService(db, { send: async () => 'ok' as const });
  const contacts = new NoticeContacts(db, undefined);
  const notices = new NoticeStore(db);
  const balance = new MemoryCloudBalance();
  const learned = new Map<string, number>();
  let service!: ReturnType<typeof accountErasure>;
  const delegate = {
    status: (a: string) => service.status(a), preview: (a: string) => service.preview(a), schedule: (a: string, c: string) => service.schedule(a, c),
    cancel: (a: string) => service.cancel(a), exportData: (a: string) => service.exportData(a), erase: (a: string) => service.erase(a), runDue: () => service.runDue(),
    owedRefunds: () => service.owedRefunds(), markRefunded: (a: string, r: string) => service.markRefunded(a, r),
  };
  const h = await startHarness(null, undefined, { collab, accountErasure: delegate });
  service = accountErasure({
    db, store: h.app.store, collab, cloudPhotos: cloud, push, contacts, notices, balance,
    safeCopy: { usage: async () => opts.safeCopyBytes ?? 0 },
    learning: { forget: async (id) => { const n = learned.get(id) ?? 0; learned.delete(id); return n; } },
    now: () => h.clock.now,
  });
  // Sessions last 15 minutes and these tests move the clock by days, so every call signs in afresh.
  const session = async (id: string, role: 'user' | 'admin' = 'user') => (await h.app.issueSession(id, role)).accessToken;
  const person = async (email: string) => {
    const id = await h.app.createAccount(email, 'a-long-password-123', 'user');
    return { id, get token() { return session(id); } };
  };
  const adminId = (await h.app.store.findAccountByEmailHash(sha256Hex('admin@example.test')))!.accountId;
  const ann = await person('ann@example.test');
  const bob = await person('bob@example.test');
  const at = h.clock.now;
  await h.app.store.insertLicence(newLicence('lic_ann_pro', 'paid', at, { accountId: ann.id, paid: true, source: 'purchase' }));
  await h.app.store.activateDevice({ licenceId: 'lic_ann_pro', planIfNew: 'paid', deviceHash: 'd'.repeat(64), platform: 'macos', appVersion: '26.11.0', newActivationId: 'act_1', nowMs: at });
  const kites = await collab.createProject({ accountId: ann.id, displayName: 'Ann' }, 'Kites', at);
  const raptors = await collab.createProject({ accountId: bob.id, displayName: 'Bob' }, 'Raptors', at);
  const join = (projectId: string, who: string, name: string, owner: string) => db.runTransaction(async (tx) => {
    const ref = db.collection('collab_projects').doc(projectId);
    const p = (await tx.get(ref)).data() as any;
    tx.set(ref, { ...p, members: [...p.members, { accountId: who, role: 'commenter', displayName: name, addedAtMs: at, addedByAccountId: owner }] });
    tx.set(db.collection('collab_memberships').doc(`${who}|${projectId}`), { accountId: who, projectId, role: 'commenter', name: p.name });
  });
  await join(kites.projectId, bob.id, 'Bob', ann.id);
  await join(raptors.projectId, ann.id, 'Ann', bob.id);
  await cloud.signUpload(kites.projectId, 'a'.repeat(64), ann.id, { variant: 'preview', sha256: 'b'.repeat(64), bytes: 1000, name: 'kite.jpg' }, at, 1e9);
  await cloud.commit(kites.projectId, 'a'.repeat(64), 'preview');
  await collab.addComment(kites.projectId, 'p1', bob.id, { text: 'Lovely light', point: null }, at);
  const annsComment = await collab.addComment(raptors.projectId, 'p9', ann.id, { text: 'Is this a merlin?', point: { x: 0.5, y: 0.5 } }, at);
  await push.register(ann.id, 'fcm-ann-phone', 'android', at);
  await contacts.rememberSignIn(ann.id, 'firebaseUidAnn', 'e'.repeat(64));
  await db.collection('collab_notices').doc(`${ann.id}|n1`).set({ accountId: ann.id, id: 'n1', key: 'k', readAtMs: null, updatedAtMs: at });
  await db.collection('paddle_pro_orders').doc('txn_01').set({ transactionId: 'txn_01', accountId: ann.id, emailHash: 'e'.repeat(64), reference: 'r1', majorVersion: 1, invoiceNumber: 'INV-1', priceId: 'pri_1', createdAt: '2026-11-20T10:00:00Z' });
  await balance.credit(ann.id, 250_000, 'topup:1');
  learned.set(ann.id, 3);
  const call = {
    exportData: async (token: string | Promise<string>) => h.call('GET', '/v1/me/data-export', { token: await token }),
    status: async (token: Promise<string>) => h.call('GET', '/v1/me/deletion', { token: await token }),
    schedule: async (token: Promise<string>, confirm: string) => h.call('POST', '/v1/me/deletion', { token: await token, body: { confirm } }),
    cancel: async (token: Promise<string>) => h.call('POST', '/v1/me/deletion/cancel', { token: await token }),
    run: async () => h.call('POST', '/v1/admin/account-deletions/run', { token: await session(adminId, 'admin') }),
    refunds: async (token?: string) => h.call('GET', '/v1/admin/balance-refunds', { token: token ?? await session(adminId, 'admin') }),
    refunded: async (accountId: string, paddleReference: string) => h.call('POST', `/v1/admin/balance-refunds/${accountId}/refunded`, { token: await session(adminId, 'admin'), body: { paddleReference } }),
  };
  return { h, db, balance, storage, collab, push, contacts, learned, ann, bob, kites, raptors, annsComment, call };
}

test('Download my data: the account, licences, devices, projects, cloud photo list, comments and purchases, as JSON', async () => {
  const { h, ann, kites, call } = await rig();
  try {
    const r = await call.exportData(ann.token);
    assert.equal(r.status, 200);
    assert.equal(r.body.format, 'inflight-account-data/1');
    assert.equal(r.body.account.accountId, ann.id);
    assert.deepEqual(r.body.licences.map((l: any) => [l.licenceId, l.status, l.paid]), [['lic_ann_pro', 'active', true]]);
    assert.deepEqual(r.body.devices.map((d: any) => d.platform), ['macos']);
    assert.deepEqual(r.body.sharedProjects.map((p: any) => [p.name, p.role]).sort(), [['Kites', 'owner'], ['Raptors', 'commenter']]);
    assert.deepEqual(r.body.cloudPhotos.map((p: any) => [p.projectId, p.name, p.previewBytes]), [[kites.projectId, 'kite.jpg', 1000]]);
    assert.deepEqual(r.body.comments.map((c: any) => c.text), ['Is this a merlin?'], 'only her own comments, not Bob’s');
    assert.deepEqual(r.body.purchases, [{ transactionId: 'txn_01', invoiceNumber: 'INV-1', majorVersion: 1, createdAt: '2026-11-20T10:00:00Z' }]);
    assert.deepEqual(r.body.alertDevices.map((d: any) => d.platform), ['android']);
    assert.equal(r.body.cloudBalanceMillicredits, 250_000);
    assert.equal(JSON.stringify(r.body).includes('fcm-ann-phone'), false, 'no push token in the download');
    assert.equal((await call.exportData('not-a-token')).status, 401);
  } finally { await h.close(); }
});

test('Delete my account: typed confirmation, nothing goes for 30 days, and it can be undone', async () => {
  const { h, ann, collab, call } = await rig();
  try {
    const before = await call.status(ann.token);
    assert.equal(before.status, 200);
    assert.equal(before.body.deletion, null);
    assert.deepEqual(before.body.preview, { ownedSharedProjects: 1, peopleInOwnedProjects: 1, otherSharedProjects: 1, cloudPhotos: 1, licences: 1, balanceMillicredits: 250_000, blocked: null });

    assert.equal((await call.schedule(ann.token, 'yes')).body.error.code, 'DELETION_NOT_CONFIRMED');
    const scheduled = await call.schedule(ann.token, ' delete ');
    assert.equal(scheduled.status, 200, 'the word is not case-sensitive and spaces around it are ignored');
    assert.equal(scheduled.body.deletion.deleteAfterMs, h.clock.now + DELETION_GRACE_MS);
    assert.equal((await call.schedule(ann.token, 'DELETE')).body.deletion.deleteAfterMs, scheduled.body.deletion.deleteAfterMs, 'asking twice keeps the date');

    // Day 29: the scheduler deletes nothing and Ann still signs in and uses everything.
    h.clock.now += DELETION_GRACE_MS - 86_400_000;
    assert.deepEqual((await call.run()).body, { deleted: 0, failed: 0 });
    assert.equal((await call.status(ann.token)).body.deletion.status, 'scheduled');
    assert.equal((await collab.myProjects(ann.id)).length, 2);

    assert.equal((await call.cancel(ann.token)).status, 200);
    assert.equal((await call.status(ann.token)).body.deletion, null);
    h.clock.now += 5 * 86_400_000;
    assert.deepEqual((await call.run()).body, { deleted: 0, failed: 0 }, 'an undone deletion never runs');
    assert.ok(await h.app.store.getAccount(ann.id));
    assert.equal((await call.cancel(ann.token)).status, 404);
    const audit = (await h.app.store.listAudit(50)).map((e) => e.action);
    assert.ok(audit.includes('account.deletion.scheduled') && audit.includes('account.deletion.cancelled'));
  } finally { await h.close(); }
});

test('after 30 days the control plane deletes for real; Paddle orders stay and other people keep their projects', async () => {
  const { h, db, storage, collab, push, contacts, learned, ann, bob, kites, raptors, annsComment, call } = await rig();
  try {
    await call.schedule(ann.token, 'DELETE');
    h.clock.now += DELETION_GRACE_MS;
    const lastSession = await ann.token;
    const run = await call.run();
    assert.deepEqual(run.body, { deleted: 1, failed: 0 });

    assert.equal(await h.app.store.getAccount(ann.id), undefined, 'account row gone');
    assert.equal(await h.app.store.findAccountByEmailHash(sha256Hex('ann@example.test')), undefined, 'email link gone: signing in again starts a new account');
    assert.equal((await call.exportData(lastSession)).status, 401, 'her session no longer works');
    const licence = (await h.app.store.getLicence('lic_ann_pro'))!;
    assert.deepEqual([licence.accountId, licence.emailHash, licence.status], [null, null, 'revoked'], 'licence row kept for tax records, detached and revoked');
    assert.deepEqual(await h.app.store.listActivationsForLicence('lic_ann_pro'), []);

    // Kites (Ann the only owner) is gone for everyone, with its cloud photo; Bob's own Raptors stays, without Ann.
    assert.deepEqual((await collab.myProjects(bob.id)).map((p) => p.name), ['Raptors']);
    assert.equal((await db.collection('collab_projects').doc(kites.projectId).get()).exists, false);
    assert.equal(storage.has(cloudKey(kites.projectId, 'a'.repeat(64), 'preview')), false, 'cloud preview deleted from storage');
    assert.equal((await db.collection('collab_cloud_photos').where('projectId', '==', kites.projectId).get()).size, 0);
    assert.equal((await db.collection('collab_comments').where('projectId', '==', kites.projectId).get()).size, 0);
    const raptorsNow = await collab.project(raptors.projectId, bob.id);
    assert.deepEqual(raptorsNow.members.map((m) => m.displayName), ['Bob']);
    const [comment] = await collab.comments(raptors.projectId, 'p9', bob.id);
    assert.deepEqual([comment.id, comment.authorName, comment.text], [annsComment.id, '', 'Is this a merlin?'], 'her comment there loses her name');

    assert.deepEqual(await push.devices(ann.id), []);
    assert.deepEqual(await contacts.get(ann.id), {});
    assert.equal((await db.collection('collab_notices').where('accountId', '==', ann.id).get()).size, 0);
    assert.equal(learned.has(ann.id), false);
    assert.equal((await db.collection('paddle_pro_orders').doc('txn_01').get()).exists, true, 'purchase records stay (Paddle and UK tax law)');

    const done = (await h.app.store.listAudit(50)).find((e) => e.action === 'account.deletion.done')!;
    assert.match(done.detail, /projectsDeleted=1 projectsLeft=1 cloudPhotos=1 galleries=0 alertDevices=1 notices=1 learningRecords=3 licences=1/);
    assert.equal(done.detail.includes('ann@'), false);

    assert.deepEqual((await call.run()).body, { deleted: 0, failed: 0 }, 'running again changes nothing');
    assert.equal((await call.exportData(bob.token)).status, 200, 'Bob is untouched');
  } finally { await h.close(); }
});

test('an unused cloud balance is owed back, not lost: listed for a Paddle refund, rounded up to the penny', async () => {
  const { h, balance, ann, call } = await rig();
  try {
    await balance.debit(ann.id, 400, 'job:1'); // £2.49 and 0.6p left
    await call.schedule(ann.token, 'DELETE');
    h.clock.now += DELETION_GRACE_MS;
    const annToken = await ann.token;
    assert.deepEqual((await call.run()).body, { deleted: 1, failed: 0 });
    assert.equal(await balance.millicredits(ann.id), 0, 'the balance is emptied');
    const owed = await call.refunds();
    assert.equal(owed.status, 200);
    assert.deepEqual(owed.body.refunds.map((r: any) => [r.accountId, r.millicredits, r.pence, r.status]), [[ann.id, 249_600, 250, 'owed']]);
    const audit = await h.app.store.listAudit(50);
    assert.ok(audit.some((e) => e.action === 'balance.refund_owed' && e.detail.startsWith('250p')));
    assert.match(audit.find((e) => e.action === 'account.deletion.done')!.detail, /refundPence=250/);

    assert.equal((await call.refunds(annToken)).status, 401, 'not for the person, and her session is gone anyway');
    const paid = await call.refunded(ann.id, 'adj_01');
    assert.equal(paid.status, 200);
    assert.deepEqual([paid.body.refund.status, paid.body.refund.paddleReference], ['refunded', 'adj_01']);
    assert.deepEqual((await call.refunds()).body.refunds, [], 'nothing left owed');
    assert.equal((await call.refunded(ann.id, 'adj_02')).body.refund.paddleReference, 'adj_01', 'marking twice keeps the first');
    assert.equal((await call.refunded('acc_nobody', 'adj_03')).status, 404);
  } finally { await h.close(); }
});

test('a safe copy still online blocks deletion with the reason; only admins run the scheduler', async () => {
  const { h, ann, call } = await rig({ safeCopyBytes: 10 });
  try {
    assert.equal((await call.status(ann.token)).body.preview.blocked, 'safe-copy');
    const r = await call.schedule(ann.token, 'DELETE');
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'DELETION_SAFE_COPY');
    assert.equal((await h.call('POST', '/v1/admin/account-deletions/run', { token: await ann.token })).status, 403);
  } finally { await h.close(); }
});

test('without the service configured the routes answer 503, never pretend', async () => {
  const h = await startHarness(null);
  try {
    const r = await h.call('GET', '/v1/me/data-export', { token: h.user.token });
    assert.equal(r.status, 503);
    assert.equal(r.body.error.code, 'ERASURE_NOT_CONFIGURED');
  } finally { await h.close(); }
});

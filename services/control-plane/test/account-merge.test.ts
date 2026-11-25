import test from 'node:test';
import assert from 'node:assert/strict';
import { accountMerges, MERGE_UNDO_MS } from '../src/accountMerge.ts';
import { MemoryCloudBalance } from '../src/cloudBalance.ts';
import { CollabStore } from '../src/collaboration.ts';
import { PushService } from '../src/push.ts';
import { newLicence } from '../src/store.ts';
import { MemoryFirestore } from './memoryFirestore.ts';
import { startHarness } from './helpers.ts';

/** Two accounts the same person owns: Ann (stays) and an old Ann (closes), with Pro, balance, projects and a phone. */
async function rig(opts: { safeCopyBytes?: number } = {}) {
  const db = new MemoryFirestore();
  const balance = new MemoryCloudBalance();
  const collab = new CollabStore(db);
  const push = new PushService(db, { send: async () => 'sent' as never });
  let clock = Date.UTC(2026, 10, 25, 12);
  // The merge service needs the harness's own store, which exists only once the harness starts: delegate to it.
  let service!: ReturnType<typeof accountMerges>;
  const delegate = { ticketFor: (id: string) => service.ticketFor(id), preview: (t: string, a: string) => service.preview(t, a), merge: (t: string, a: string) => service.merge(t, a), list: (a: string) => service.list(a), undo: (m: string, a: string) => service.undo(m, a) };
  const h = await startHarness(null, undefined, { collab, accountMerge: delegate });
  service = accountMerges({ db, store: h.app.store, secret: Buffer.alloc(32, 7), balance, collab, push, safeCopy: { usage: async () => opts.safeCopyBytes ?? 0 }, now: () => clock });
  const person = async (email: string) => {
    const id = await h.app.createAccount(email, 'a-long-password-123', 'user');
    return { id, token: (await h.app.issueSession(id, 'user')).accessToken };
  };
  const ann = await person('ann@example.test');
  const old = await person('ann.old@example.test');
  await h.app.store.insertLicence(newLicence('lic_old_pro', 'paid', clock, { accountId: old.id }));
  await balance.credit(old.id, 1_234_000, 'topup:1');
  await balance.credit(ann.id, 500_000, 'topup:2');
  const owned = await collab.createProject({ accountId: old.id, displayName: 'Ann (old)' }, 'Kites', clock);
  const shared = await collab.createProject({ accountId: ann.id, displayName: 'Ann' }, 'Raptors', clock);
  await collab.change(shared.projectId, ann.id, { kind: 'inviteEmail', invite: { emailHash: 'f'.repeat(64), role: 'commenter', displayName: 'Ann (old)' } }, clock);
  // Old Ann joined Ann's project as a commenter (direct add, as if accepted).
  await db.runTransaction(async (tx) => {
    const ref = db.collection('collab_projects').doc(shared.projectId);
    const p = (await tx.get(ref)).data() as any;
    tx.set(ref, { ...p, invites: [], members: [...p.members, { accountId: old.id, role: 'commenter', displayName: 'Ann (old)', addedAtMs: clock, addedByAccountId: ann.id }] });
    tx.set(db.collection('collab_memberships').doc(`${old.id}|${shared.projectId}`), { accountId: old.id, projectId: shared.projectId, role: 'commenter', name: 'Raptors' });
  });
  await push.register(old.id, 'fcm-token-old-phone', 'android', clock);
  const routes = {
    ticket: (token: string) => h.call('POST', '/v1/me/merge/ticket', { token }),
    preview: (token: string, ticket: string) => h.call('POST', '/v1/me/merge/preview', { token, body: { ticket } }),
    merge: (token: string, ticket: string) => h.call('POST', '/v1/me/merge', { token, body: { ticket } }),
    undo: (token: string, mergeId: string) => h.call('POST', '/v1/me/merge/undo', { token, body: { mergeId } }),
  };
  return { h, service, balance, collab, push, ann, old, owned, shared, routes, advance: (ms: number) => { clock += ms; h.clock.now += ms; } };
}

test('merging two accounts: proved from both, previewed, then everything moves once and the other account closes', async () => {
  const { h, service, balance, collab, push, ann, old, owned, shared } = await rig();
  try {
    const { ticket } = service.ticketFor(old.id); // signed in as the old account
    const preview = await service.preview(ticket, ann.id); // then as Ann
    assert.deepEqual([preview.licences, preview.balanceMillicredits, preview.projects, preview.pushDevices, preview.blocked], [1, 1_234_000, 2, 1, null]);
    const before = (await balance.millicredits(ann.id)) + (await balance.millicredits(old.id));

    const record = await service.merge(ticket, ann.id);
    assert.equal(record.status, 'done');
    assert.equal((await h.app.store.getLicence('lic_old_pro'))!.accountId, ann.id, 'Pro moved');
    assert.equal(await balance.millicredits(ann.id), 1_734_000);
    assert.equal(await balance.millicredits(old.id), 0);
    assert.equal((await balance.millicredits(ann.id)) + (await balance.millicredits(old.id)), before, 'not a credit more or less');
    const mine = await collab.myProjects(ann.id);
    assert.deepEqual(mine.map((p) => [p.name, p.role]).sort(), [['Kites', 'owner'], ['Raptors', 'owner']], 'ownership moved; the higher role kept');
    assert.deepEqual(await collab.myProjects(old.id), []);
    assert.equal((await collab.payerOf(owned.projectId)), ann.id, 'cloud storage billing follows the owner');
    assert.deepEqual((await push.devices(ann.id)).map((d) => d.token), ['fcm-token-old-phone']);
    assert.equal((await h.app.store.getAccount(old.id))!.status, 'merged');
    const audit = (await h.app.store.listAudit(50)).find((e) => e.action === 'account.merge')!;
    assert.match(audit.detail, /licences=1 balance=1234000mc projects=2 devices=1/);

    // Idempotent: the same ticket again repeats nothing, and the balance is not moved twice.
    const again = await service.merge(ticket, ann.id);
    assert.equal(again.mergeId, record.mergeId);
    assert.equal(await balance.millicredits(ann.id), 1_734_000);
    assert.ok(shared.projectId);
  } finally { await h.close(); }
});

test('a merge that stopped half way resumes with the same ticket and moves the balance once', async () => {
  const { h, service, balance, collab, ann, old } = await rig();
  try {
    const { ticket } = service.ticketFor(old.id);
    const real = collab.transferMembership.bind(collab);
    let fail = true;
    collab.transferMembership = async (...args: Parameters<typeof real>) => { if (fail) { fail = false; throw new Error('network'); } return real(...args); };
    await assert.rejects(service.merge(ticket, ann.id));
    assert.equal((await h.app.store.getAccount(old.id))!.status, 'suspended', 'nothing new happens on it mid-move');
    const done = await service.merge(ticket, ann.id);
    assert.equal(done.status, 'done');
    assert.equal(await balance.millicredits(ann.id), 1_734_000, 'moved exactly once across the retry');
    assert.equal(done.projects.length, 2);
  } finally { await h.close(); }
});

test('undo within 30 days puts everything back; not after, and not once the moved balance is spent', async () => {
  const { h, service, balance, collab, ann, old, owned } = await rig();
  try {
    let record = await service.merge(service.ticketFor(old.id).ticket, ann.id);
    record = await service.undo(record.mergeId, ann.id);
    assert.equal(record.status, 'undone');
    assert.equal((await h.app.store.getLicence('lic_old_pro'))!.accountId, old.id);
    assert.deepEqual([await balance.millicredits(ann.id), await balance.millicredits(old.id)], [500_000, 1_234_000]);
    assert.deepEqual((await collab.myProjects(old.id)).map((p) => [p.name, p.role]).sort(), [['Kites', 'owner'], ['Raptors', 'commenter']]);
    assert.deepEqual((await collab.myProjects(ann.id)).map((p) => p.name), ['Raptors']);
    assert.equal(await collab.payerOf(owned.projectId), old.id);
    assert.equal((await h.app.store.getAccount(old.id))!.status, 'active');
    assert.equal((await service.undo(record.mergeId, ann.id)).status, 'undone', 'undo twice is harmless');

    // Merge again (a new ticket), spend the balance, and undo is refused with nothing changed.
    const second = await service.merge(service.ticketFor(old.id).ticket, ann.id);
    assert.ok(await balance.debit(ann.id, 1_600_000, 'cloud:job:1'));
    await assert.rejects(service.undo(second.mergeId, ann.id), /cloud balance has been used/);
    assert.equal((await h.app.store.getAccount(old.id))!.status, 'merged');
    assert.equal((await h.app.store.getLicence('lic_old_pro'))!.accountId, ann.id, 'nothing was moved back');

    const third = await rig();
    try {
      const r = await third.service.merge(third.service.ticketFor(third.old.id).ticket, third.ann.id);
      third.advance(MERGE_UNDO_MS + 1);
      await assert.rejects(third.service.undo(r.mergeId, third.ann.id), /30 days/);
    } finally { await third.h.close(); }
  } finally { await h.close(); }
});

test('refused: the same account, an expired or forged ticket, or a safe copy still held on the other account', async () => {
  const { h, service, ann, old, advance } = await rig();
  try {
    await assert.rejects(service.merge(service.ticketFor(ann.id).ticket, ann.id), /signed in to/);
    const stale = service.ticketFor(old.id).ticket;
    advance(16 * 60_000);
    await assert.rejects(service.merge(stale, ann.id), /15 minutes/);
    const ticket = service.ticketFor(old.id).ticket;
    const [body] = ticket.split('.');
    await assert.rejects(service.merge(`${body}.${'A'.repeat(43)}`, ann.id), /again/);
    assert.equal((await h.app.store.getAccount(old.id))!.status, 'active');
  } finally { await h.close(); }
  const blocked = await rig({ safeCopyBytes: 1000 });
  try {
    const t = blocked.service.ticketFor(blocked.old.id).ticket;
    assert.equal((await blocked.service.preview(t, blocked.ann.id)).blocked, 'safe-copy');
    await assert.rejects(blocked.service.merge(t, blocked.ann.id), /safe copy/);
    assert.equal((await blocked.h.app.store.getLicence('lic_old_pro'))!.accountId, blocked.old.id, 'nothing moved');
  } finally { await blocked.h.close(); }
});

test('the routes: a ticket from one sign-in, merge from the other, and the closed account says where to go', async () => {
  const { h, routes, ann, old } = await rig();
  try {
    assert.equal((await h.call('POST', '/v1/me/merge/ticket', {})).status, 401);
    const ticket = (await routes.ticket(old.token)).body.ticket as string;
    const preview = await routes.preview(ann.token, ticket);
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.blocked, null);
    const merged = await routes.merge(ann.token, ticket);
    assert.equal(merged.status, 200, JSON.stringify(merged.body));
    assert.equal(merged.body.licences, 1);
    assert.equal((await routes.ticket(old.token)).status, 401, 'the closed account has no session any more');
    const list = await h.call('GET', '/v1/me/merges', { token: ann.token });
    assert.equal(list.body.merges[0].mergeId, merged.body.mergeId);
    assert.equal((await routes.undo(ann.token, merged.body.mergeId)).body.status, 'undone');
  } finally { await h.close(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { CollabStore } from '../src/collaboration.ts';
import { newLicence } from '../src/store.ts';
import { MemoryFirestore } from './memoryFirestore.ts';
import { startHarness } from './helpers.ts';

async function harness() {
  const h = await startHarness(undefined, undefined, { collab: new CollabStore(new MemoryFirestore()) });
  const person = async (email: string, plan?: 'subscriber' | 'paid') => {
    const id = await h.app.createAccount(email, 'a-long-password-123', 'user');
    if (plan) await h.app.store.insertLicence(newLicence(`lic-${id}`, plan, h.clock.now, { accountId: id }));
    return { id, token: (await h.app.issueSession(id, 'user')).accessToken };
  };
  const owner = await person('owner@example.test', 'subscriber');
  const editor = await person('editor@example.test');
  const client = await person('client@example.test');
  const call = (method: string, path: string, token: string, body?: object) => h.call(method, path, { token, body });
  const created = await call('POST', '/v1/collab/projects', owner.token, { name: 'Kites', displayName: 'Dave' });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const pid = created.body.projectId as string;
  const P = `/v1/collab/projects/${pid}`;
  return { h, owner, editor, client, call, pid, P, person };
}

test('shared projects answer 503 until set up, and need the Cloud plan to create', async () => {
  const bare = await startHarness();
  try {
    const r = await bare.call('GET', '/v1/collab/projects', { token: bare.user.token });
    assert.equal(r.status, 503); assert.equal(r.body.error.code, 'COLLAB_NOT_CONFIGURED');
  } finally { await bare.close(); }
  const { h, editor, call } = await harness();
  try {
    const r = await call('POST', '/v1/collab/projects', editor.token, { name: 'X', displayName: 'E' });
    assert.equal(r.status, 403); assert.equal(r.body.error.code, 'COLLAB_NOT_ENTITLED');
  } finally { await h.close(); }
});

test('Pro bought through checkout (a paid licence) can share; a Basic payer cannot invite anyone new', async () => {
  const { h, owner, call, P, person } = await harness();
  try {
    const buyer = await person('buyer@example.test', 'paid');
    assert.equal((await call('POST', '/v1/collab/projects', buyer.token, { name: 'Gulls', displayName: 'B' })).status, 200, 'Pro checkout grants a paid licence');
    assert.equal((await call('POST', `${P}/members`, owner.token, { kind: 'inviteEmail', email: 'a@example.test', role: 'editor' })).status, 200);
    await h.app.store.setLicenceValidUntil(`lic-${owner.id}`, h.clock.now - 1, h.clock.now); // Pro lapsed: the owner is Basic now
    const r = await call('POST', `${P}/members`, owner.token, { kind: 'inviteEmail', email: 'b@example.test', role: 'editor' });
    assert.equal(r.status, 403); assert.equal(r.body.error.code, 'COLLAB_NOT_ENTITLED');
    assert.equal((await call('GET', P, owner.token)).status, 200, 'the project and everyone in it stay readable');
  } finally { await h.close(); }
});

test('invite by email, accept, roles, and a client sees only their photos and themselves', async () => {
  const { h, owner, editor, client, call, P } = await harness();
  try {
    let r = await call('POST', `${P}/members`, owner.token, { kind: 'inviteEmail', email: 'Editor@Example.test', role: 'editor', displayName: 'Erin' });
    assert.equal(r.status, 200);
    assert.equal(JSON.stringify(r.body).includes('editor@example.test'), false, 'the email address itself is never stored or echoed');
    assert.equal((await call('POST', `${P}/members`, owner.token, { kind: 'inviteEmail', email: 'client@example.test', role: 'client' })).body.error.code, 'COLLAB_CLIENT_NEEDS_PHOTOS');
    assert.equal((await call('POST', `${P}/members`, owner.token, { kind: 'inviteEmail', email: 'client@example.test', role: 'client', displayName: 'Cleo', photoIds: ['p1'] })).status, 200);
    assert.equal((await call('GET', P, editor.token)).status, 404, 'not a member until accepted');
    assert.deepEqual((await call('GET', '/v1/collab/invites', editor.token)).body.invites.map((i: any) => [i.name, i.role]), [['Kites', 'editor']]);
    assert.equal((await call('POST', `${P}/accept`, editor.token, { displayName: 'Erin' })).status, 200);
    assert.equal((await call('POST', `${P}/accept`, client.token, { displayName: 'Cleo' })).status, 200);
    assert.equal((await call('POST', `${P}/accept`, h.user.token, { displayName: 'Nobody' })).status, 404);
    assert.deepEqual((await call('GET', '/v1/collab/invites', editor.token)).body.invites, [], 'accepting clears the invitation');
    r = await call('GET', P, client.token);
    assert.deepEqual(r.body.members.map((m: any) => m.displayName), ['Cleo']);
    assert.deepEqual(r.body.invites, []);
    r = await call('GET', '/v1/collab/projects', editor.token);
    assert.deepEqual(r.body.projects.map((p: any) => p.role), ['editor']);
    r = await call('POST', `${P}/members`, editor.token, { kind: 'remove', accountId: owner.id });
    assert.equal(r.status, 403);
    r = await call('POST', `${P}/members`, owner.token, { kind: 'remove', accountId: owner.id });
    assert.equal(r.body.error.code, 'COLLAB_LAST_OWNER');
    assert.equal((await call('POST', `${P}/photos/p2/lease`, client.token, { deviceId: 'client-device' })).status, 403, 'a client never edits');
  } finally { await h.close(); }
});

async function withEditor() {
  const ctx = await harness();
  await ctx.call('POST', `${ctx.P}/members`, ctx.owner.token, { kind: 'inviteEmail', email: 'editor@example.test', role: 'editor', displayName: 'Erin' });
  await ctx.call('POST', `${ctx.P}/accept`, ctx.editor.token, { displayName: 'Erin' });
  return ctx;
}

test('photos are checked out one by one, and a lapsed checkout frees itself', async () => {
  const { h, owner, editor, call, P } = await withEditor();
  try {
    const mine = await call('POST', `${P}/photos/p1/lease`, owner.token, { deviceId: 'owner-desktop' });
    assert.equal(mine.status, 200);
    const token = mine.body.lease.token as string;
    assert.equal(mine.body.settings.networkExpiryMs, 120_000);
    const taken = await call('POST', `${P}/photos/p1/lease`, editor.token, { deviceId: 'erin-laptop' });
    assert.equal(taken.status, 409); assert.equal(taken.body.error.code, 'COLLAB_PHOTO_CHECKED_OUT'); assert.equal(taken.body.error.detail.holder, 'Dave');
    assert.equal((await call('POST', `${P}/photos/p1/lease`, owner.token, { deviceId: 'owner-tablet' })).body.error.detail.sameAccount, true);
    assert.equal((await call('POST', `${P}/photos/p2/lease`, editor.token, { deviceId: 'erin-laptop' })).status, 200, 'another photo at the same time');
    const leases = await call('GET', `${P}/leases`, editor.token);
    assert.deepEqual(leases.body.leases.map((l: any) => [l.photoId, l.holder, l.mine]).sort(), [['p1', 'Dave', false], ['p2', 'Erin', true]]);
    h.clock.now += 60_000;
    assert.equal((await call('POST', `${P}/photos/p1/heartbeat`, owner.token, { token, editing: false })).status, 200);
    h.clock.now += 120_000; // laptop closed: no heartbeat for two minutes
    assert.equal((await call('POST', `${P}/photos/p1/lease`, editor.token, { deviceId: 'erin-laptop' })).status, 200);
    const lost = await call('POST', `${P}/photos/p1/heartbeat`, owner.token, { token, editing: true });
    assert.equal(lost.status, 409); assert.equal(lost.body.error.code, 'COLLAB_LEASE_LOST');
  } finally { await h.close(); }
});

test('shared saves are never last-write-wins; virtual copies keep the head', async () => {
  const { h, owner, editor, call, P } = await withEditor();
  try {
    const a = (await call('POST', `${P}/photos/p1/lease`, owner.token, { deviceId: 'owner-desktop' })).body.lease.token;
    assert.equal((await call('POST', `${P}/photos/p1/revisions`, editor.token, { token: a, baseRevisionId: null, recipe: { exposure: 1 } })).status, 409, 'someone else’s token is refused');
    const r1 = await call('POST', `${P}/photos/p1/revisions`, owner.token, { token: a, baseRevisionId: null, recipe: { exposure: 0.5 } });
    assert.equal(r1.status, 200); assert.equal(r1.body.revision.number, 1);
    const stale = await call('POST', `${P}/photos/p1/revisions`, owner.token, { token: a, baseRevisionId: null, recipe: { exposure: 0.7 } });
    assert.equal(stale.status, 409); assert.equal(stale.body.error.code, 'COLLAB_STALE_BASE'); assert.equal(stale.body.error.detail.headId, r1.body.revision.id);
    const copy = await call('POST', `${P}/photos/p1/revisions`, owner.token, { token: a, baseRevisionId: r1.body.revision.id, recipe: { exposure: 2 }, virtualCopyOf: r1.body.revision.id });
    assert.equal(copy.status, 200);
    const hist = await call('GET', `${P}/photos/p1/revisions`, editor.token);
    assert.equal(hist.body.headId, r1.body.revision.id);
    assert.deepEqual(hist.body.revisions.map((r: any) => [r.number, r.virtualCopyOf ?? null]), [[1, null], [2, r1.body.revision.id]]);
    assert.equal(JSON.stringify(hist.body).includes('exposure'), false, 'the list carries no recipes');
    assert.deepEqual((await call('GET', `${P}/photos/p1/revisions/${r1.body.revision.id}`, editor.token)).body.recipe, { exposure: 0.5 });
    // Check in, then the editor continues from the head.
    assert.equal((await call('POST', `${P}/photos/p1/release`, owner.token, { token: a, action: 'checked-in' })).body.released, true);
    const b = await call('POST', `${P}/photos/p1/lease`, editor.token, { deviceId: 'erin-laptop' });
    assert.equal(b.body.lease.baseRevisionId, r1.body.revision.id);
    assert.equal((await call('POST', `${P}/photos/p1/revisions`, editor.token, { token: b.body.lease.token, baseRevisionId: r1.body.revision.id, recipe: { exposure: 0.6 } })).body.revision.number, 3);
  } finally { await h.close(); }
});

test('only the owner overrides a checkout, with a recorded reason; the switch stops new work but not reading', async () => {
  const { h, owner, editor, call, P } = await withEditor();
  try {
    await call('POST', `${P}/photos/p1/lease`, editor.token, { deviceId: 'erin-laptop' });
    assert.equal((await call('POST', `${P}/photos/p1/override`, editor.token, { reason: 'mine now' })).status, 403);
    assert.equal((await call('POST', `${P}/photos/p1/override`, owner.token, { reason: 'Erin is away' })).body.released, true);
    const audit = await call('GET', `${P}/audit`, owner.token);
    assert.deepEqual(audit.body.entries.map((e: any) => e.action), ['acquired', 'overridden']);
    assert.equal(audit.body.entries[1].reason, 'Erin is away');
    assert.equal((await call('GET', `${P}/audit`, editor.token)).status, 403);
    await h.app.store.setSetting('switch_collaboration', '0');
    const off = await call('POST', `${P}/photos/p1/lease`, editor.token, { deviceId: 'erin-laptop' });
    assert.equal(off.status, 503); assert.equal(off.body.error.code, 'COLLAB_DISABLED');
    assert.equal((await call('GET', P, editor.token)).status, 200);
  } finally { await h.close(); }
});

test('live cursors: a one-hour token for one project, carrying the role, only for members', async () => {
  const signed: any[] = [];
  const presence = { databaseUrl: 'https://inflight-presence.europe-west1.firebasedatabase.app', sign: async (uid: string, claims: any, iat: number) => { signed.push({ uid, claims, iat }); return 'signed.jwt'; } };
  const h = await startHarness(undefined, undefined, { collab: new CollabStore(new MemoryFirestore()), presence });
  try {
    const id = await h.app.createAccount('o@example.test', 'a-long-password-123', 'user');
    await h.app.store.insertLicence(newLicence('lic-o', 'subscriber', h.clock.now, { accountId: id }));
    const token = (await h.app.issueSession(id, 'user')).accessToken;
    const pid = (await h.call('POST', '/v1/collab/projects', { token, body: { name: 'K', displayName: 'Dave' } })).body.projectId;
    const r = await h.call('POST', `/v1/collab/projects/${pid}/presence-token`, { token });
    assert.equal(r.status, 200);
    assert.equal(r.body.customToken, 'signed.jwt');
    assert.equal(r.body.databaseUrl, presence.databaseUrl);
    assert.equal(r.body.expiresAtMs, (Math.floor(h.clock.now / 1000) + 3600) * 1000);
    assert.deepEqual(signed[0].claims, { p: pid, r: 'owner' });
    assert.ok(!signed[0].uid.includes(id), 'the presence id does not reveal the account id');
    assert.equal((await h.call('POST', `/v1/collab/projects/${pid}/presence-token`, { token: h.user.token })).status, 404);
  } finally { await h.close(); }
});

test('comments: members comment and pin, clients only when allowed and on their photos, the author or an editor marks them done', async () => {
  const { h, owner, editor, client, call, P } = await harness();
  try {
    await call('POST', `${P}/members`, owner.token, { kind: 'inviteEmail', email: 'editor@example.test', role: 'editor', displayName: 'Erin' });
    await call('POST', `${P}/members`, owner.token, { kind: 'inviteEmail', email: 'client@example.test', role: 'client', displayName: 'Cleo', photoIds: ['p1'] });
    await call('POST', `${P}/accept`, editor.token, { displayName: 'Erin' });
    await call('POST', `${P}/accept`, client.token, { displayName: 'Cleo' });
    assert.equal((await call('POST', `${P}/photos/p1/comments`, client.token, { text: 'Lovely' })).status, 403, 'clients comment only when the owner allows it');
    let r = await call('POST', `${P}/photos/p1/comments`, owner.token, { text: 'Brighter eye?', point: { x: 0.4, y: 0.3 } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const id = r.body.comment.id as string;
    assert.equal(r.body.comment.authorName, 'Dave');
    assert.equal((await call('GET', `${P}/photos/p2/comments`, client.token)).status, 403, 'a client sees only their photos');
    assert.equal((await call('POST', `${P}/photos/p1/comments`, editor.token, { text: '  ' })).status, 400);
    assert.equal((await call('POST', `${P}/photos/p1/comments`, editor.token, { text: 'Off the photo', point: { x: 2, y: 0 } })).status, 400);
    assert.equal((await call('POST', `${P}/photos/p1/comments`, editor.token, { text: 'On it' })).status, 200);
    r = await call('GET', `${P}/photos/p1/comments`, owner.token);
    assert.deepEqual(r.body.comments.map((c: any) => [c.authorName, c.text, c.point]), [['Dave', 'Brighter eye?', { x: 0.4, y: 0.3 }], ['Erin', 'On it', null]]);
    r = await call('POST', `${P}/comments/${id}/resolve`, editor.token, { resolved: true });
    assert.equal(r.status, 200); assert.equal(typeof r.body.comment.resolvedAtMs, 'number');
    assert.equal((await call('POST', `${P}/comments/${id}/resolve`, h.user.token, { resolved: false })).status, 404, 'not a member');
  } finally { await h.close(); }
});

test('privacy: a client never reads or touches the team comments on their photos, only their own', async () => {
  const { h, owner, editor, client, call, P } = await harness();
  try {
    await call('POST', `${P}/members`, owner.token, { kind: 'inviteEmail', email: 'editor@example.test', role: 'editor', displayName: 'Erin' });
    await call('POST', `${P}/members`, owner.token, { kind: 'inviteEmail', email: 'client@example.test', role: 'client', displayName: 'Cleo', photoIds: ['p1'] });
    await call('POST', `${P}/accept`, editor.token, { displayName: 'Erin' });
    await call('POST', `${P}/accept`, client.token, { displayName: 'Cleo' });
    const team = (await call('POST', `${P}/photos/p1/comments`, editor.token, { text: 'Team only: retouch the perch, client is fussy', point: { x: 0.2, y: 0.2 } })).body.comment;
    let r = await call('GET', `${P}/photos/p1/comments`, client.token);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.comments, [], 'the team comment on the client\'s own photo is not sent to them');
    assert.equal(JSON.stringify(r.body).includes('fussy'), false);
    r = await call('POST', `${P}/comments/${team.id}/resolve`, client.token, { resolved: true });
    assert.equal(r.status, 404, 'to a client the team comment does not exist (no 403 that would reveal it)');
    assert.equal(JSON.stringify(r.body).includes('fussy'), false);

    // With client comments allowed, they see and resolve their own, and the team still sees everything.
    await call('POST', `${P}/members`, owner.token, { kind: 'options', options: { clientsMayComment: true } });
    const mine = (await call('POST', `${P}/photos/p1/comments`, client.token, { text: 'Can the branch go?' })).body.comment;
    r = await call('GET', `${P}/photos/p1/comments`, client.token);
    assert.deepEqual(r.body.comments.map((c: any) => c.text), ['Can the branch go?']);
    assert.equal((await call('POST', `${P}/comments/${mine.id}/resolve`, client.token, { resolved: true })).status, 200);
    r = await call('GET', `${P}/photos/p1/comments`, owner.token);
    assert.deepEqual(r.body.comments.map((c: any) => c.authorName), ['Erin', 'Cleo']);
  } finally { await h.close(); }
});

test('replies: one level of threads, a reply reopens a done thread, the thread is done as a whole, clients reply only in their own threads', async () => {
  const { h, owner, editor, client, call, P } = await harness();
  try {
    await call('POST', `${P}/members`, owner.token, { kind: 'inviteEmail', email: 'editor@example.test', role: 'editor', displayName: 'Erin' });
    await call('POST', `${P}/members`, owner.token, { kind: 'inviteEmail', email: 'client@example.test', role: 'client', displayName: 'Cleo', photoIds: ['p1'] });
    await call('POST', `${P}/accept`, editor.token, { displayName: 'Erin' });
    await call('POST', `${P}/accept`, client.token, { displayName: 'Cleo' });
    await call('POST', `${P}/members`, owner.token, { kind: 'options', options: { clientsMayComment: true } });
    const root = (await call('POST', `${P}/photos/p1/comments`, owner.token, { text: 'Brighter eye?', point: { x: 0.4, y: 0.3 } })).body.comment;
    assert.equal(root.replyTo, null);
    let r = await call('POST', `${P}/photos/p1/comments`, editor.token, { text: 'Done in revision 3', point: { x: 0.9, y: 0.9 }, replyTo: root.id });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const reply = r.body.comment;
    assert.deepEqual([reply.replyTo, reply.point], [root.id, null], 'a reply belongs to its thread and has no pin of its own');
    assert.equal((await call('POST', `${P}/photos/p1/comments`, owner.token, { text: 'nested', replyTo: reply.id })).body.error.code, 'COLLAB_REPLY_TO_THREAD');
    assert.equal((await call('POST', `${P}/photos/p2/comments`, owner.token, { text: 'wrong photo', replyTo: root.id })).status, 404);
    assert.equal((await call('POST', `${P}/comments/${reply.id}/resolve`, editor.token, { resolved: true })).body.error.code, 'COLLAB_RESOLVE_THREAD');

    // Done, then a reply reopens it.
    assert.equal((await call('POST', `${P}/comments/${root.id}/resolve`, editor.token, { resolved: true })).status, 200);
    await call('POST', `${P}/photos/p1/comments`, owner.token, { text: 'Still soft on the left', replyTo: root.id });
    r = await call('GET', `${P}/photos/p1/comments`, owner.token);
    assert.equal(r.body.comments.find((c: any) => c.id === root.id).resolvedAtMs, null, 'a reply reopens a done thread');
    assert.deepEqual(r.body.comments.filter((c: any) => c.replyTo === root.id).map((c: any) => c.text), ['Done in revision 3', 'Still soft on the left']);

    // A client cannot reply in a team thread (it does not exist for them), but the team can answer the client's own thread.
    assert.equal((await call('POST', `${P}/photos/p1/comments`, client.token, { text: 'peek', replyTo: root.id })).status, 404);
    const theirs = (await call('POST', `${P}/photos/p1/comments`, client.token, { text: 'Can the branch go?' })).body.comment;
    assert.equal((await call('POST', `${P}/photos/p1/comments`, editor.token, { text: 'Yes, removed', replyTo: theirs.id })).status, 200);
    r = await call('GET', `${P}/photos/p1/comments`, client.token);
    assert.deepEqual(r.body.comments.map((c: any) => [c.authorName, c.text]), [['Cleo', 'Can the branch go?'], ['Erin', 'Yes, removed']], 'their own thread, with the team\'s answer, and nothing else');
  } finally { await h.close(); }
});

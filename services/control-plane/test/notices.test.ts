import test from 'node:test';
import assert from 'node:assert/strict';
import { CollabStore } from '../src/collaboration.ts';
import { GalleryStore } from '../src/gallery.ts';
import { NoticeStore, type NoticeDelivery } from '../src/notices.ts';
import { MemorySafeCopyStorage } from '../src/safeCopy.ts';
import { newLicence } from '../src/store.ts';
import { MemoryFirestore } from './memoryFirestore.ts';
import { startHarness } from './helpers.ts';

/** A fake FCM sender and hello@ mailer that record what they were asked to send. */
function fakeDelivery(devices: Set<string>) {
  const sent: { route: 'push' | 'email'; accountId: string; body: string }[] = [];
  const delivery: NoticeDelivery = {
    push: async (accountId, m) => { if (!devices.has(accountId)) return 'no-device'; sent.push({ route: 'push', accountId, body: m.body }); return 'sent'; },
    email: async (accountId, m) => { sent.push({ route: 'email', accountId, body: m.text }); return 'sent'; },
  };
  return { sent, delivery };
}

async function team(devices: Set<string>) {
  const db = new MemoryFirestore();
  const { sent, delivery } = fakeDelivery(devices);
  const h = await startHarness(undefined, undefined, { collab: new CollabStore(db), gallery: new GalleryStore(db, new MemorySafeCopyStorage()), notices: new NoticeStore(db, delivery) });
  const person = async (email: string, plan?: 'subscriber') => {
    const id = await h.app.createAccount(email, 'a-long-password-123', 'user');
    if (plan) await h.app.store.insertLicence(newLicence(`lic-${id}`, plan, h.clock.now, { accountId: id }));
    return { id, token: (await h.app.issueSession(id, 'user')).accessToken };
  };
  const owner = await person('owner@example.test', 'subscriber');
  const editor = await person('editor@example.test');
  const commenter = await person('commenter@example.test');
  const call = (method: string, path: string, token: string, body?: object) => h.call(method, path, { token, body });
  const pid = (await call('POST', '/v1/collab/projects', owner.token, { name: 'Kites', displayName: 'Dave' })).body.projectId as string;
  const P = `/v1/collab/projects/${pid}`;
  for (const [who, role, name, email] of [[editor, 'editor', 'Erin', 'editor@example.test'], [commenter, 'commenter', 'Cam', 'commenter@example.test']] as const) {
    await call('POST', `${P}/members`, owner.token, { kind: 'inviteEmail', email, role, displayName: name });
    await call('POST', `${P}/accept`, who.token, { displayName: name });
  }
  return { h, sent, P, call, owner, editor, commenter };
}

test('a comment lands in the inbox of those who edit; push when they have a device, email only as the last resort', async () => {
  const devices = new Set<string>();
  const { h, sent, P, call, owner, editor, commenter } = await team(devices);
  devices.add(editor.id);
  try {
    // The owner had the app open a minute ago: in-app only. Erin has a phone: push. Nobody is emailed.
    await call('GET', '/v1/collab/notices', owner.token);
    await call('GET', '/v1/collab/notices', commenter.token);
    h.clock.now += 60_000;
    const comment = (await call('POST', `${P}/photos/p1/comments`, commenter.token, { text: 'Soft eye', point: { x: 0.5, y: 0.5 } })).body.comment;
    assert.ok(comment?.id, 'the comment itself is saved as before');
    assert.deepEqual(sent.map((s) => [s.route, s.accountId]), [['push', editor.id]]);
    assert.match(sent[0].body, /Cam commented on a photo/);

    let inbox = (await call('GET', '/v1/collab/notices', owner.token)).body;
    assert.equal(inbox.unread, 1);
    assert.deepEqual(inbox.notices.map((n: any) => [n.kind, n.photoId, n.actors]), [['comment', 'p1', ['Cam']]]);
    assert.equal(JSON.stringify(inbox).includes('Soft eye'), false, 'the comment text is not copied into notices');
    assert.equal((await call('GET', '/v1/collab/notices', commenter.token)).body.unread, 0, 'never told about your own action');

    // A second comment on the same photo merges into the unread notice and is not sent again.
    await call('POST', `${P}/photos/p1/comments`, editor.token, { text: 'Agreed' });
    inbox = (await call('GET', '/v1/collab/notices', owner.token)).body;
    assert.deepEqual(inbox.notices.map((n: any) => [n.count, n.actors]), [[2, ['Cam', 'Erin']]]);
    assert.equal(sent.length, 1);
    assert.equal((await call('GET', '/v1/collab/notices', commenter.token)).body.unread, 1, 'an earlier commenter on the photo hears about later comments');

    // Erin marks Cam's comment done. Cam has no device and has not had the app open for 15 minutes: email.
    h.clock.now += 20 * 60_000;
    editor.token = (await h.app.issueSession(editor.id, 'user')).accessToken; // sessions are short-lived
    owner.token = (await h.app.issueSession(owner.id, 'user')).accessToken;
    assert.equal((await call('POST', `${P}/comments/${comment.id}/resolve`, editor.token, { resolved: true })).status, 200);
    assert.deepEqual(sent.slice(1).map((s) => [s.route, s.accountId]), [['email', commenter.id]]);
    assert.match(sent[1].body, /Erin resolved a comment/);

    // Reading clears the unread count.
    assert.equal((await call('POST', '/v1/collab/notices/read', owner.token, { ids: 'all' })).body.read, 1);
    assert.equal((await call('GET', '/v1/collab/notices', owner.token)).body.unread, 0);
    assert.equal((await call('POST', '/v1/collab/notices/read', owner.token, { ids: 'everything' })).status, 400);
  } finally { await h.close(); }
});

test('client feedback tells the gallery managers once per gallery while unread, never the client or a commenter', async () => {
  const { h, sent, P, call, owner, editor, commenter } = await team(new Set());
  try {
    const g = (await call('POST', `${P}/galleries`, owner.token, { name: 'Selects', photoIds: ['p1', 'p2'], allowFavourites: true })).body;
    for (const photo of ['p1', 'p2']) {
      await call('POST', `/v1/collab/galleries/${g.galleryId}/photos/${photo}/upload-url`, owner.token, { sha256: 'a'.repeat(64), bytes: 1000 });
      await call('POST', `/v1/collab/galleries/${g.galleryId}/photos/${photo}/commit`, owner.token);
    }
    for (const photo of ['p1', 'p2']) {
      const r = await h.call('POST', '/v1/gallery/feedback', { body: { token: g.linkToken, visitor: 'visitor-one', photoId: photo, kind: 'favourite', text: null } });
      assert.equal(r.status, 200);
    }
    const ownerInbox = (await call('GET', '/v1/collab/notices', owner.token)).body;
    assert.deepEqual(ownerInbox.notices.map((n: any) => [n.kind, n.galleryName, n.count, n.actors]), [['client-feedback', 'Selects', 2, []]]);
    assert.equal((await call('GET', '/v1/collab/notices', editor.token)).body.unread, 1, 'editors manage galleries too');
    assert.equal((await call('GET', '/v1/collab/notices', commenter.token)).body.unread, 0, 'a commenter does not');
    assert.equal(sent.filter((s) => s.route === 'email').length, 2, 'one email each (no devices, app not open), not one per favourite');
  } finally { await h.close(); }
});

test('the inbox needs sign-in and answers 503 until shared projects are set up', async () => {
  const bare = await startHarness();
  try {
    assert.equal((await bare.call('GET', '/v1/collab/notices', { token: bare.user.token })).status, 503);
    assert.equal((await bare.call('GET', '/v1/collab/notices', {})).status, 401);
  } finally { await bare.close(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { CollabStore } from '../src/collaboration.ts';
import { NoticeStore } from '../src/notices.ts';
import { FcmSender, PushService, noticeDelivery, type PushMessage, type SendResult } from '../src/push.ts';
import { MemoryFirestore } from './memoryFirestore.ts';
import { startHarness } from './helpers.ts';

const TOKEN_A = 'fcm-token-aaaaaaaaaaaaaaaaaaaa:APA91b';
const TOKEN_B = 'fcm-token-bbbbbbbbbbbbbbbbbbbb:APA91b';

/** A fake FCM: records what it was given; tokens in `gone` answer as FCM does for an uninstalled app. */
function fakeFcm(gone = new Set<string>()) {
  const sent: { token: string; message: PushMessage }[] = [];
  return { sent, gone, sender: { send: async (token: string, message: PushMessage): Promise<SendResult> => { if (gone.has(token)) return 'gone'; sent.push({ token, message }); return 'ok'; } } };
}

async function setup(requireAdminSwitch = false) {
  const db = new MemoryFirestore();
  const fcm = fakeFcm();
  const emails: string[] = [];
  const push = new PushService(db, fcm.sender);
  const notices = new NoticeStore(db, noticeDelivery(push, async (accountId) => { emails.push(accountId); return 'sent'; }));
  const h = await startHarness(undefined, undefined, { collab: new CollabStore(db), notices, push, requireAdminSwitch });
  const person = async (email: string) => {
    const id = await h.app.createAccount(email, 'a-long-password-123', 'user');
    return { id, token: (await h.app.issueSession(id, 'user')).accessToken };
  };
  return { h, fcm, emails, push, person };
}

test('a device registered for alerts gets a push with names and ids only; a gone token is forgotten', async () => {
  const { h, fcm, emails, person } = await setup();
  try {
    const owner = await person('owner@example.test');
    const editor = await person('editor@example.test');
    await h.app.store.setSetting('switch_collaboration', '1');
    const { newLicence } = await import('../src/store.ts');
    await h.app.store.insertLicence(newLicence('lic-owner', 'subscriber', h.clock.now, { accountId: owner.id }));
    const call = (m: string, p: string, token: string, body?: object) => h.call(m, p, { token, body });
    const pid = (await call('POST', '/v1/collab/projects', owner.token, { name: 'Kites', displayName: 'Dave' })).body.projectId as string;
    await call('POST', `/v1/collab/projects/${pid}/members`, owner.token, { kind: 'inviteEmail', email: 'editor@example.test', role: 'editor', displayName: 'Erin' });
    await call('POST', `/v1/collab/projects/${pid}/accept`, editor.token, { displayName: 'Erin' });

    assert.equal((await call('POST', '/v1/notify/push/devices', owner.token, { token: TOKEN_A, platform: 'web' })).body.devices, 1);
    assert.equal((await call('POST', '/v1/notify/push/devices', owner.token, { token: 'short', platform: 'web' })).status, 400);
    assert.equal((await call('POST', '/v1/notify/push/devices', owner.token, { token: TOKEN_B, platform: 'fax' })).status, 400);
    const status = (await call('GET', '/v1/notify/push', owner.token)).body;
    assert.deepEqual(status, { available: true, preferences: { comments: true, clientFeedback: true, news: true }, devices: 1 });

    await call('POST', `/v1/collab/projects/${pid}/photos/p1/comments`, editor.token, { text: 'Secret words', point: { x: 0.5, y: 0.5 } });
    assert.equal(fcm.sent.length, 1);
    const m = fcm.sent[0];
    assert.equal(m.token, TOKEN_A);
    assert.match(m.message.body, /Erin commented on a photo/);
    assert.equal(m.message.data.kind, 'comment');
    assert.equal(m.message.data.projectId, pid);
    assert.equal(m.message.data.photoId, 'p1');
    assert.equal(JSON.stringify(m).includes('Secret words'), false, 'comment text never rides in a push');
    assert.equal(emails.length, 0, 'pushed, so not emailed');

    // The browser's data was cleared: FCM says the token is gone. It is deleted, and email takes over.
    fcm.gone.add(TOKEN_A);
    await call('POST', '/v1/collab/notices/read', owner.token, { ids: 'all' });
    h.clock.now += 20 * 60_000;
    editor.token = (await h.app.issueSession(editor.id, 'user')).accessToken;
    owner.token = (await h.app.issueSession(owner.id, 'user')).accessToken;
    await call('POST', `/v1/collab/projects/${pid}/photos/p2/comments`, editor.token, { text: 'Another', point: { x: 0.1, y: 0.1 } });
    assert.equal((await call('GET', '/v1/notify/push', owner.token)).body.devices, 0);
    assert.deepEqual(emails, [owner.id]);
  } finally { await h.close(); }
});

test('a kind switched off is neither pushed nor emailed, and stays in the inbox', async () => {
  const db = new MemoryFirestore();
  const fcm = fakeFcm();
  const push = new PushService(db, fcm.sender);
  await push.register('acc1', TOKEN_A, 'android', 1);
  await push.setPreferences('acc1', { comments: false });
  assert.equal(await push.push('acc1', { title: 't', body: 'b', data: { kind: 'comment', projectId: 'p' } }), 'off');
  assert.equal(await push.push('acc1', { title: 't', body: 'b', data: { kind: 'client-feedback', projectId: 'p' } }), 'sent');
  const emails: string[] = [];
  const notices = new NoticeStore(db, noticeDelivery(push, async (a) => { emails.push(a); return 'sent'; }));
  const counts = await notices.deliver({ kind: 'comment', projectId: 'p1', projectName: 'Kites', photoId: 'x', actorName: 'Erin', recipients: ['acc1'] } as never, 10);
  assert.deepEqual(counts, { inbox: 1, push: 0, email: 0 });
  assert.equal((await notices.inbox('acc1', 11)).unread, 1);
});

test('a token belongs to the last account that signed in on it; only its owner can remove it; at most ten devices', async () => {
  const db = new MemoryFirestore();
  const push = new PushService(db, fakeFcm().sender);
  await push.register('alice', TOKEN_A, 'web', 1);
  await push.register('bob', TOKEN_A, 'web', 2); // same browser, Bob signs in
  assert.equal((await push.devices('alice')).length, 0, 'Alice no longer gets alerts on Bob\'s browser');
  assert.equal(await push.remove('alice', TOKEN_A), false);
  assert.equal(await push.remove('bob', TOKEN_A), true);
  for (let i = 0; i < 12; i += 1) await push.register('carol', `token-number-${String(i).padStart(2, '0')}-xxxxxxxxxx`, 'ios', 100 + i);
  const left = (await push.devices('carol')).map((d) => d.token).sort();
  assert.equal(left.length, 10);
  assert.equal(left.includes('token-number-00-xxxxxxxxxx'), false, 'the device seen longest ago is dropped first');
});

test('the push routes answer 503 until set up, and nothing registers while the admin switch is off', async () => {
  const bare = await startHarness();
  try {
    assert.equal((await bare.call('GET', '/v1/notify/push', { token: bare.user.token })).status, 503);
    assert.equal((await bare.call('GET', '/v1/notify/push', {})).status, 401);
  } finally { await bare.close(); }
  const { h, fcm, push } = await setup(true);
  try {
    assert.equal((await h.call('GET', '/v1/notify/push', { token: h.user.token })).body.available, false);
    const r = await h.call('POST', '/v1/notify/push/devices', { token: h.user.token, body: { token: TOKEN_A, platform: 'web' } });
    assert.equal(r.status, 503);
    assert.equal(r.body.error?.code ?? r.body.code, 'PUSH_OFF');
    await push.register('someone', TOKEN_B, 'web', 1);
    assert.equal(await push.push('someone', { title: 't', body: 'b', data: { kind: 'comment', projectId: 'p' } }), 'no-device');
    assert.equal(fcm.sent.length, 0, 'switch off: nothing is sent');
    assert.equal((await h.call('POST', '/v1/admin/switches/set', { token: h.adminToken, body: { key: 'push', on: true } })).status, 200);
    assert.equal((await h.call('POST', '/v1/notify/push/devices', { token: h.user.token, body: { token: TOKEN_A, platform: 'web' } })).status, 200);
  } finally { await h.close(); }
});

test('the FCM sender posts HTTP v1 with the service identity and spots dead tokens', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  let answer = new Response('{}', { status: 200 });
  const fetcher = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return answer; }) as unknown as typeof fetch;
  const fcm = new FcmSender('inflight-prod', async () => 'access-token', fetcher);
  assert.equal(await fcm.send(TOKEN_A, { title: 'Erin commented on a photo', body: 'Kites', data: { kind: 'comment', projectId: 'p' } }), 'ok');
  assert.equal(calls[0].url, 'https://fcm.googleapis.com/v1/projects/inflight-prod/messages:send');
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, 'Bearer access-token');
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.message.token, TOKEN_A);
  assert.equal(body.message.data.title, 'Erin commented on a photo');
  answer = new Response('{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}', { status: 404 });
  assert.equal(await fcm.send(TOKEN_A, { title: 't', body: 'b', data: {} }), 'gone');
  answer = new Response('{"error":{"status":"UNAVAILABLE"}}', { status: 503 });
  assert.equal(await fcm.send(TOKEN_A, { title: 't', body: 'b', data: {} }), 'error');
  assert.throws(() => new FcmSender('Not A Project!', async () => 'x', fetcher));
});

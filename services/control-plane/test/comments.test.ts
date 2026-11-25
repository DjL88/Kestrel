import test from 'node:test';
import assert from 'node:assert/strict';
import { CollabStore } from '../src/collaboration.ts';
import { newLicence } from '../src/store.ts';
import { MemoryFirestore } from './memoryFirestore.ts';
import { startHarness } from './helpers.ts';

/** One shared project with an owner, an editor, a commenter and a client who sees only p1. */
async function team() {
  const collab = new CollabStore(new MemoryFirestore());
  const h = await startHarness(undefined, undefined, { collab });
  const person = async (email: string, plan?: 'subscriber') => {
    const id = await h.app.createAccount(email, 'a-long-password-123', 'user');
    if (plan) await h.app.store.insertLicence(newLicence(`lic-${id}`, plan, h.clock.now, { accountId: id }));
    return { id, token: (await h.app.issueSession(id, 'user')).accessToken };
  };
  const owner = await person('owner@example.test', 'subscriber');
  const editor = await person('editor@example.test');
  const commenter = await person('commenter@example.test');
  const client = await person('client@example.test');
  const outsider = await person('outsider@example.test');
  const call = (method: string, path: string, token: string, body?: object) => h.call(method, path, { token, body });
  const pid = (await call('POST', '/v1/collab/projects', owner.token, { name: 'Kites', displayName: 'Dave' })).body.projectId as string;
  const P = `/v1/collab/projects/${pid}`;
  for (const [who, role, name, photoIds] of [[editor, 'editor', 'Erin'], [commenter, 'commenter', 'Cam'], [client, 'client', 'Cleo', ['p1']]] as const) {
    const email = { [editor.id]: 'editor@example.test', [commenter.id]: 'commenter@example.test', [client.id]: 'client@example.test' }[who.id];
    assert.equal((await call('POST', `${P}/members`, owner.token, { kind: 'inviteEmail', email, role, displayName: name, ...(photoIds ? { photoIds } : {}) })).status, 200);
    assert.equal((await call('POST', `${P}/accept`, who.token, { displayName: name })).status, 200);
  }
  return { h, collab, pid, P, call, owner, editor, commenter, client, outsider };
}

test('a thread is pinned to a relative point, replied to, resolved and reopened, and nothing is lost', async () => {
  const { h, collab, pid, P, call, owner, editor, commenter } = await team();
  try {
    let r = await call('POST', `${P}/photos/p1/comments`, commenter.token, { pin: { x: 0.31, y: 0.62 }, text: '  The eye is soft  ' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const thread = r.body.thread;
    assert.deepEqual(thread.pin, { x: 0.31, y: 0.62 });
    assert.equal(thread.entries[0].text, 'The eye is soft');
    assert.equal(thread.entries[0].authorName, 'Cam', 'the name is the member name, not what the request says');
    const T = `${P}/photos/p1/comments/${thread.id}`;
    assert.equal((await call('POST', T, editor.token, { kind: 'reply', text: 'Sharpened in revision 3' })).status, 200);
    r = await call('POST', T, editor.token, { kind: 'resolve' });
    assert.equal(r.body.thread.resolved.byName, 'Erin');
    assert.equal((await call('POST', T, editor.token, { kind: 'resolve' })).body.error.code, 'COMMENT_ALREADY_RESOLVED');
    assert.deepEqual((await call('GET', `${P}/comments`, owner.token)).body.counts, {}, 'a resolved thread is not counted as open');
    r = await call('POST', T, commenter.token, { kind: 'reopen' });
    assert.equal(r.body.thread.resolved, null);
    assert.equal(r.body.thread.entries.length, 2);
    assert.deepEqual((await call('GET', `${P}/comments`, owner.token)).body.counts, { p1: 1 });
    r = await call('GET', `${P}/photos/p1/comments`, owner.token);
    assert.equal(r.body.threads.length, 1); assert.equal(r.body.threads[0].number, 1); assert.equal(r.body.canComment, true);
    // Who hears about it: a new thread goes to those who may edit; a reply to the people in the thread.
    const started = await collab.startComment(pid, 'p2', commenter.id, { pin: null, text: 'Crop tighter?' }, 1);
    assert.deepEqual(started.event.recipients.sort(), [owner.id, editor.id].sort());
    const replied = await collab.changeComment(pid, 'p2', started.thread.id, editor.id, { kind: 'reply', text: 'Done' }, 2);
    assert.deepEqual(replied.event.recipients, [commenter.id]);
  } finally { await h.close(); }
});

test('bad pins, empty or long text, and people who may not comment are refused', async () => {
  const { h, P, call, owner, outsider } = await team();
  try {
    assert.equal((await call('POST', `${P}/photos/p1/comments`, owner.token, { pin: { x: 1.5, y: 0.5 }, text: 'x' })).status, 400);
    assert.equal((await call('POST', `${P}/photos/p1/comments`, owner.token, { pin: null, text: '   ' })).body.error.code, 'COMMENT_EMPTY');
    assert.equal((await call('POST', `${P}/photos/p1/comments`, owner.token, { pin: null, text: 'x'.repeat(2001) })).body.error.code, 'COMMENT_TOO_LONG');
    assert.equal((await call('POST', `${P}/photos/p1/comments`, outsider.token, { pin: null, text: 'hi' })).status, 404);
    assert.equal((await call('GET', `${P}/photos/p1/comments`, outsider.token)).status, 404);
    assert.equal((await call('POST', `${P}/photos/bad%20id/comments`, owner.token, { pin: null, text: 'hi' })).status, 400);
    assert.equal((await call('POST', `${P}/photos/p1/comments/nope`, owner.token, { kind: 'resolve' })).status, 404);
  } finally { await h.close(); }
});

test('a client never sees team comments, and comments only when the owner allows it, on their own photos', async () => {
  const { h, P, call, owner, client } = await team();
  try {
    const team1 = (await call('POST', `${P}/photos/p1/comments`, owner.token, { pin: { x: 0.5, y: 0.5 }, text: 'Team only: retouch the perch' })).body.thread;
    let r = await call('GET', `${P}/photos/p1/comments`, client.token);
    assert.deepEqual(r.body.threads, []); assert.equal(r.body.canComment, false);
    assert.equal((await call('POST', `${P}/photos/p1/comments`, client.token, { pin: null, text: 'Love it' })).status, 403);
    assert.equal((await call('POST', `${P}/members`, owner.token, { kind: 'options', options: { clientsMayComment: true } })).status, 200);
    assert.equal((await call('POST', `${P}/photos/p2/comments`, client.token, { pin: null, text: 'Not my photo' })).status, 403, 'only the photos chosen for them');
    r = await call('POST', `${P}/photos/p1/comments`, client.token, { pin: { x: 0.1, y: 0.9 }, text: 'Can the branch go?' });
    assert.equal(r.status, 200);
    r = await call('GET', `${P}/photos/p1/comments`, client.token);
    assert.deepEqual(r.body.threads.map((t: any) => t.entries[0].text), ['Can the branch go?']);
    assert.deepEqual((await call('GET', `${P}/comments`, client.token)).body.counts, { p1: 1 });
    assert.equal((await call('POST', `${P}/photos/p1/comments/${team1.id}`, client.token, { kind: 'reply', text: 'peek' })).status, 404, 'a team thread does not exist for a client');
    assert.equal((await call('GET', `${P}/photos/p1/comments`, owner.token)).body.threads.length, 2, 'the team sees both');
  } finally { await h.close(); }
});

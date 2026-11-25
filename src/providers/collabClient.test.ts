import test from 'node:test';
import assert from 'node:assert/strict';
import { collabClient, CollabError } from './collabClient';

function fakeServer(routes: Record<string, (body: any, auth: string | undefined) => [number, unknown]>) {
  const calls: { url: string; method: string; body: any; auth?: string; credentials?: string }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: String(init.method), body, auth: headers.authorization, credentials: init.credentials as string });
    const path = new URL(url).pathname;
    const route = routes[`${init.method} ${path}`];
    const [status, json] = route ? route(body, headers.authorization) : [404, { error: { code: 'NOT_FOUND', message: 'Not found.' } }];
    return new Response(JSON.stringify(json), { status });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

const session = { 'POST /v1/auth/firebase': () => [200, { accessToken: 'sess' }] as [number, unknown] };

test('sharing is not contacted without a control plane or a signed-in person', async () => {
  const { calls, fetcher } = fakeServer({});
  await assert.rejects(() => collabClient(undefined, async () => 'id', fetcher).myProjects(), (e: CollabError) => e.kind === 'not-configured');
  await assert.rejects(() => collabClient('https://cp.example.test', async () => null, fetcher).myProjects(), (e: CollabError) => e.kind === 'sign-in');
  assert.equal(calls.length, 0);
  assert.equal(collabClient(undefined, async () => 'id', fetcher).configured, false);
});

test('each action exchanges the Firebase token for a session, sends no cookies, and maps refusals to plain kinds', async () => {
  const { calls, fetcher } = fakeServer({
    ...session,
    'POST /v1/collab/projects': (body) => body.name === 'Kites' ? [200, { projectId: 'p1' }] : [403, { error: { code: 'COLLAB_NOT_ENTITLED', message: 'Cloud plan' } }],
    'POST /v1/collab/projects/p1/members': (body) => [200, { projectId: 'p1', name: 'Kites', me: {}, members: [], invites: [{ role: body.role, displayName: '' }] }],
    'GET /v1/collab/invites': () => [503, { error: { code: 'COLLAB_DISABLED', message: 'off' } }],
  });
  const client = collabClient('https://cp.example.test', async () => 'firebase-id', fetcher);
  assert.equal(await client.create('Kites', 'Dave'), 'p1');
  assert.deepEqual(calls[0], { url: 'https://cp.example.test/v1/auth/firebase', method: 'POST', body: { credential: 'firebase-id' }, auth: undefined, credentials: 'omit' });
  assert.equal(calls[1].auth, 'Bearer sess');
  await assert.rejects(() => client.create('Other', 'Dave'), (e: CollabError) => e.kind === 'not-entitled');
  await assert.rejects(() => client.invites(), (e: CollabError) => e.kind === 'switched-off');
  const view = await client.invite('p1', 'a@b.test', 'client', ['x1']);
  assert.equal(view.invites[0].role, 'client');
  assert.deepEqual(calls.at(-1)!.body, { kind: 'inviteEmail', email: 'a@b.test', role: 'client', photoIds: ['x1'] });
});

test('comments: threads on a photo, a pinned start, and reply, resolve and reopen go to the right routes', async () => {
  const thread = { id: 't1', photoId: 'ph 1', pin: { x: 0.2, y: 0.4 }, entries: [], resolved: null, createdAtMs: 1, updatedAtMs: 1 };
  const { calls, fetcher } = fakeServer({
    ...session,
    'GET /v1/collab/projects/p1/comments': () => [200, { counts: { a: 2 } }],
    'GET /v1/collab/projects/p1/photos/ph%201/comments': () => [200, { threads: [{ ...thread, number: 1 }], canComment: true }],
    'POST /v1/collab/projects/p1/photos/ph%201/comments': () => [200, { thread }],
    'POST /v1/collab/projects/p1/photos/ph%201/comments/t1': (body) => [200, { thread: { ...thread, resolved: body.kind === 'resolve' ? { byName: 'A' } : null } }],
  });
  const client = collabClient('https://cp.example.test', async () => 'firebase-id', fetcher);
  assert.deepEqual(await client.commentCounts('p1'), { a: 2 });
  assert.equal((await client.comments('p1', 'ph 1')).threads[0].number, 1);
  assert.equal((await client.startComment('p1', 'ph 1', { x: 0.2, y: 0.4 }, 'Soft eye')).id, 't1');
  assert.deepEqual(calls.at(-1)!.body, { pin: { x: 0.2, y: 0.4 }, text: 'Soft eye' });
  assert.ok((await client.changeComment('p1', 'ph 1', 't1', { kind: 'resolve' })).resolved);
  assert.deepEqual(calls.at(-1)!.body, { kind: 'resolve' });
});

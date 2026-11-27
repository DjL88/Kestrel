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

test('the first action exchanges the Firebase token for a session, sends no cookies, and maps refusals to plain kinds', async () => {
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
  assert.deepEqual(calls.at(-1)!.body, { kind: 'inviteEmail', email: 'a@b.test', role: 'client', photoIds: ['x1'], language: 'en-GB' });
});

const jwt = (payload: object) => 'h.' + Buffer.from(JSON.stringify(payload)).toString('base64url') + '.sig';

test('a session nearing its end is renewed quietly with its refresh token, not by a full sign-in', async () => {
  let signIns = 0;
  let refreshes = 0;
  const { calls, fetcher } = fakeServer({
    'POST /v1/auth/firebase': () => { signIns += 1; return [200, { accessToken: `s${signIns}`, refreshToken: `r${signIns}`, expiresIn: 900 }]; },
    'POST /v1/auth/refresh': (body) => { refreshes += 1; return body.refreshToken === 'r1' ? [200, { accessToken: 'renewed', refreshToken: 'r-next', expiresIn: 900 }] : [401, { error: { code: 'AUTH_TOKEN_EXPIRED' } }]; },
    'GET /v1/collab/notices': () => [200, { notices: [], unread: 0 }],
  });
  // Firebase hands out a new ID token every hour for the same person: that alone is not a reason to sign in again.
  let idToken = jwt({ user_id: 'uid-1', iat: 1 });
  const client = collabClient('https://cp.example.test', async () => idToken, fetcher);
  await client.notices();
  idToken = jwt({ user_id: 'uid-1', iat: 2 });
  await client.notices();
  assert.equal(signIns, 1);
  const original = Date.now;
  try {
    Date.now = () => original() + 15 * 60_000; // the inbox poll after the session ended
    await client.notices();
    assert.equal(signIns, 1, 'no second audited sign-in');
    assert.equal(refreshes, 1);
    assert.equal(calls.at(-1)!.auth, 'Bearer renewed');
    Date.now = () => original() + 30 * 60_000; // the next refresh token is refused (server restarted): one ordinary sign-in
    await client.notices();
    assert.equal(refreshes, 2);
    assert.equal(signIns, 2);
  } finally { Date.now = original; }
  // Someone else signing in is never served the first person's session.
  idToken = jwt({ user_id: 'uid-2' });
  await client.notices();
  assert.equal(signIns, 3);
});

test('one sign-in serves many actions: the session is reused until the ID token changes, it nears expiry, or the server refuses it', async () => {
  let issued = 0;
  let accepted = new Set<string>();
  const { calls, fetcher } = fakeServer({
    'POST /v1/auth/firebase': () => { issued += 1; accepted.add(`Bearer s${issued}`); return [200, { accessToken: `s${issued}`, expiresIn: 900 }]; },
    'GET /v1/collab/projects': (_b, auth) => (auth && accepted.has(auth) ? [200, { projects: [] }] : [401, { error: { code: 'UNAUTHORIZED', message: 'Sign in again.' } }]),
  });
  let idToken = 'firebase-a';
  const client = collabClient('https://cp.example.test', async () => idToken, fetcher);
  // A gallery of many photos is dozens of calls; the control plane allows 10 sign-ins a minute from one address.
  await Promise.all(Array.from({ length: 12 }, () => client.myProjects()));
  for (let i = 0; i < 12; i += 1) await client.myProjects();
  assert.equal(calls.filter((c) => c.url.endsWith('/v1/auth/firebase')).length, 1);
  assert.ok(calls.filter((c) => !c.url.endsWith('/auth/firebase')).every((c) => c.auth === 'Bearer s1'));

  idToken = 'firebase-b'; // signed in as someone else, or Firebase refreshed the ID token
  await client.myProjects();
  assert.equal(issued, 2);
  assert.equal(calls.at(-1)!.auth, 'Bearer s2');

  accepted = new Set(); // the server restarted: the reused session is refused once, then one fresh sign-in
  await client.myProjects();
  assert.equal(issued, 3);
  assert.equal(calls.at(-1)!.auth, 'Bearer s3');

  accepted = new Set(); // refused again straight after a fresh sign-in: no loop, the person is asked to sign in
  issued = 100;
  const original = Date.now;
  try {
    Date.now = () => original() + 900_000; // past the session's life: a fresh exchange, not a retry
    await assert.rejects(async () => { accepted = new Set(); const c2 = collabClient('https://cp.example.test', async () => 'firebase-c', (async (url: string, init: RequestInit) => {
      if (url.endsWith('/auth/firebase')) return new Response(JSON.stringify({ accessToken: 'never-accepted', expiresIn: 900 }), { status: 200 });
      return new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'no' } }), { status: 401 });
    }) as unknown as typeof fetch); await c2.myProjects(); }, (e: CollabError) => e.kind === 'sign-in');
    await client.myProjects();
    assert.equal(issued, 101, 'an expired session is exchanged again before use');
  } finally { Date.now = original; }
});

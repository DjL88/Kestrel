import test from 'node:test';
import assert from 'node:assert/strict';
import { accountMergeClient, MergeError } from './accountMergeClient';

test('the ticket comes from the other sign-in; preview, merge and undo from this one; refusals keep their code', async () => {
  const calls: { path: string; auth?: string; body?: any }[] = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const fetcher = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    const auth = (init.headers as Record<string, string>).authorization;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, auth, body });
    if (path === '/v1/auth/firebase') return json(200, { accessToken: body.credential === 'other-id' ? 'other-session' : 'my-session' });
    if (path === '/v1/me/merge/ticket') return json(200, { ticket: 'tkt', expiresAtMs: 1 });
    if (path === '/v1/me/merge/preview') return json(200, { mergeId: 'mrg_1', licences: 1, balanceMillicredits: 1000, projects: 2, pushDevices: 0, blocked: null });
    if (path === '/v1/me/merge') return json(409, { error: { code: 'MERGE_SAFE_COPY', message: 'safe copy' } });
    if (path === '/v1/me/merges') return json(200, { merges: [{ mergeId: 'mrg_1', status: 'done' }] });
    return json(200, { status: 'undone' });
  }) as unknown as typeof fetch;
  const client = accountMergeClient('https://cp.example.test', async () => 'my-id', fetcher);
  assert.equal(await client.ticket('other-id'), 'tkt');
  assert.equal(calls[1].auth, 'Bearer other-session', 'the ticket is asked for as the other account');
  assert.equal((await client.preview('tkt')).projects, 2);
  assert.equal(calls.at(-1)!.auth, 'Bearer my-session');
  assert.deepEqual(calls.at(-1)!.body, { ticket: 'tkt' });
  await assert.rejects(client.merge('tkt'), (e: MergeError) => e.code === 'MERGE_SAFE_COPY');
  assert.equal((await client.list())[0].mergeId, 'mrg_1');
  await client.undo('mrg_1');
  assert.deepEqual(calls.at(-1)!.body, { mergeId: 'mrg_1' });
  assert.equal(accountMergeClient(undefined, async () => 'x', fetcher).configured, false);
});

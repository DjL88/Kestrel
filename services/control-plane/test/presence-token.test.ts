import test from 'node:test';
import assert from 'node:assert/strict';
import { customTokenPayload, FIREBASE_CUSTOM_TOKEN_AUDIENCE, IamPresenceSigner } from '../src/presenceToken.ts';

test('custom tokens follow the Firebase format and last at most one hour', () => {
  const p = customTokenPayload('cp@proj.iam.gserviceaccount.com', 'kcp_x', { p: 'proj1', r: 'editor' }, 1000);
  assert.deepEqual(p, { iss: 'cp@proj.iam.gserviceaccount.com', sub: 'cp@proj.iam.gserviceaccount.com', aud: FIREBASE_CUSTOM_TOKEN_AUDIENCE, iat: 1000, exp: 4600, uid: 'kcp_x', claims: { p: 'proj1', r: 'editor' } });
});

test('the IAM signer sends the payload to signJwt with the service token and never a private key', async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const fetcher = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(JSON.stringify({ signedJwt: 'a.b.c' }), { status: 200 }); }) as unknown as typeof fetch;
  const signer = new IamPresenceSigner('https://x.firebasedatabase.app', 'cp@proj.iam.gserviceaccount.com', async () => 'access', fetcher);
  assert.equal(await signer.sign('kcp_x', { p: 'p', r: 'viewer' }, 10), 'a.b.c');
  assert.match(seen!.url, /iamcredentials\.googleapis\.com\/v1\/projects\/-\/serviceAccounts\/cp%40proj\.iam\.gserviceaccount\.com:signJwt$/);
  assert.equal((seen!.init.headers as Record<string, string>).authorization, 'Bearer access');
  assert.equal(JSON.parse(JSON.parse(String(seen!.init.body)).payload).uid, 'kcp_x');
  const failing = new IamPresenceSigner('https://x.firebasedatabase.app', 'sa', async () => 't', (async () => new Response('', { status: 403 })) as unknown as typeof fetch);
  await assert.rejects(() => failing.sign('u', { p: 'p', r: 'viewer' }, 1), /signJwt 403/);
});

test('database rules: closed by default, one project per token, clients never see team cursors, nothing extra stored', async () => {
  const { readFileSync } = await import('node:fs');
  const rules = JSON.parse(readFileSync(new URL('../../../database.rules.json', import.meta.url), 'utf8')).rules;
  assert.equal(rules['.read'], false); assert.equal(rules['.write'], false);
  const project = rules.presence.$projectId;
  assert.match(project['.read'], /auth\.token\.p === \$projectId/);
  assert.match(project['.read'], /auth\.token\.r !== 'client'/);
  assert.match(project.$uid['.write'], /auth\.uid === \$uid/);
  assert.equal(project.$uid.$other['.validate'], false);
});

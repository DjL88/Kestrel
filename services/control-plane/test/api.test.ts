import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fakeProvider, image, startHarness, type Harness } from './helpers.ts';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

const device = (name: string) => crypto.createHash('sha256').update(name).digest('hex');

test('sign-in returns a session, and a refresh token works exactly once', async () => {
  const wrong = await h.call('POST', '/v1/auth/session', { body: { email: 'user@example.test', password: 'not-the-password' } });
  assert.equal(wrong.status, 401);
  const session = await h.call('POST', '/v1/auth/session', { body: { email: 'USER@example.test', password: 'user-password-123' } });
  assert.equal(session.status, 200);
  assert.equal(session.body.expiresIn, 900);
  const me = await h.call('GET', '/v1/me/entitlements', { token: session.body.accessToken });
  assert.equal(me.status, 200);
  assert.equal(me.body.plans[0].managedAi, true);
  const refreshed = await h.call('POST', '/v1/auth/refresh', { body: { refreshToken: session.body.refreshToken } });
  assert.equal(refreshed.status, 200);
  const again = await h.call('POST', '/v1/auth/refresh', { body: { refreshToken: session.body.refreshToken } });
  assert.equal(again.status, 401, 'refresh tokens are single use');
});

test('activation is idempotent per device, capped per licence, and refused once revoked', async () => {
  const issued = await h.call('POST', '/v1/admin/licences/issue', { token: h.adminToken, body: { plan: 'paid', maxDevices: 2 } });
  const activate = (name: string) => h.call('POST', '/v1/licences/activate', { body: { licenceKey: issued.body.licenceKey, deviceHash: device(name), platform: 'windows', appVersion: '26.11.2' } });
  const first = await activate('laptop');
  assert.equal(first.status, 200);
  assert.equal((await activate('laptop')).body.activationId, first.body.activationId, 'same device, same slot');
  assert.equal((await activate('mac')).status, 200);
  const third = await activate('third');
  assert.equal(third.status, 409);
  assert.equal(third.body.error.code, 'DEVICE_LIMIT');
  assert.equal((await h.call('POST', `/v1/admin/licences/${issued.body.licenceId}/revoke`, { token: h.adminToken })).status, 200);
  const revoked = await activate('laptop');
  assert.equal(revoked.status, 403);
  assert.match(revoked.body.error.message, /local work is unaffected/);
  const forged = await h.call('POST', '/v1/licences/activate', { body: { licenceKey: `${issued.body.licenceKey.slice(0, -4)}AAAA`, deviceHash: device('x'), platform: 'windows', appVersion: '26.11.2' } });
  assert.equal(forged.status, 400);
});

test('identify returns a checked answer and spends one unit; suggest says when a photo is already balanced', async () => {
  const answer = await h.call('POST', '/v1/ai/identify', { token: h.user.token, body: { image: image(), userConsent: true } });
  assert.equal(answer.status, 200);
  assert.equal(answer.body.species, 'Common kingfisher');
  assert.equal(answer.body.abstained, false);
  const balanced = await startHarness(fakeProvider({ suggest: async () => '{}' }));
  try {
    const result = await balanced.call('POST', '/v1/ai/suggest', { token: balanced.user.token, body: { image: image(), userConsent: true } });
    assert.deepEqual(result.body, { proposal: {}, alreadyBalanced: true });
  } finally { await balanced.close(); }
});

test('no provider key, the kill switch, or no AI plan each give a clear refusal', async () => {
  const bare = await startHarness(null);
  try {
    const response = await bare.call('POST', '/v1/ai/identify', { token: bare.user.token, body: { image: image(), userConsent: true } });
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, 'AI_NOT_CONFIGURED');
  } finally { await bare.close(); }

  assert.equal((await h.call('POST', '/v1/admin/ai/killswitch', { token: h.adminToken, body: { aiDisabled: true } })).status, 200);
  const off = await h.call('POST', '/v1/ai/identify', { token: h.user.token, body: { image: image(), userConsent: true } });
  assert.equal(off.body.error.code, 'AI_DISABLED');
  await h.call('POST', '/v1/admin/ai/killswitch', { token: h.adminToken, body: { aiDisabled: false } });

  const plainId = await h.app.createAccount('free@example.test', 'free-password-123', 'user');
  const plain = await h.call('POST', '/v1/ai/identify', { token: (await h.app.issueSession(plainId, 'user')).accessToken, body: { image: image(), userConsent: true } });
  assert.equal(plain.status, 403);
  assert.equal(plain.body.error.code, 'AI_NOT_ENTITLED');
});

test('release notices only accept allow-listed https links and report the newest version', async () => {
  const bad = await h.call('POST', '/v1/admin/releases', { token: h.adminToken, body: { platform: 'windows', version: '26.11.9', url: 'https://evil.example/kestrel.exe' } });
  assert.equal(bad.status, 400);
  for (const version of ['26.11.3', '26.12.0', '26.11.10']) {
    const ok = await h.call('POST', '/v1/admin/releases', { token: h.adminToken, body: { platform: 'windows', version, url: `https://github.com/DjL88/Kestrel/releases/tag/v${version}` } });
    assert.equal(ok.status, 200);
  }
  const latest = await h.call('GET', '/v1/desktop/releases?platform=windows');
  assert.equal(latest.body.release.version, '26.12.0');
  assert.equal((await h.call('GET', '/v1/desktop/releases?platform=macos')).body.release, null);
  assert.equal((await h.call('GET', '/v1/desktop/releases?platform=linux')).status, 400);
});

test('promoting an older model version is a rollback, and the manifest revision always moves forward', async () => {
  const add = (version: string) => h.call('POST', '/v1/admin/models', { token: h.adminToken, body: { id: 'species-library-uk', kind: 'species-library', version, path: `/data/species/uk-${version}.json`, sha256: 'c'.repeat(64), bytes: 100 } });
  const promote = (version: string) => h.call('POST', '/v1/admin/models/promote', { token: h.adminToken, body: { id: 'species-library-uk', version } });
  await add('1.0.0'); await add('1.1.0');
  await promote('1.1.0');
  const r1 = (await h.call('GET', '/v1/models/manifest?app=26.11.2')).body.payload;
  await promote('1.0.0');
  const r2 = (await h.call('GET', '/v1/models/manifest?app=26.11.2')).body.payload;
  assert.equal(r1.assets.find((a: { id: string }) => a.id === 'species-library-uk').version, '1.1.0');
  assert.equal(r2.assets.find((a: { id: string }) => a.id === 'species-library-uk').version, '1.0.0');
  assert.ok(r2.revision > r1.revision, 'clients only accept a higher revision');
});

test('the OpenAPI document covers every route', async () => {
  const spec = await h.call('GET', '/openapi.json');
  assert.equal(spec.body.openapi, '3.1.0');
  for (const path of ['/v1/auth/session', '/v1/licences/activate', '/v1/me/entitlements', '/v1/ai/identify', '/v1/ai/suggest', '/v1/models/manifest', '/v1/desktop/releases', '/v1/billing/webhook', '/v1/admin/overview']) {
    assert.ok(spec.body.paths[path], path);
  }
  assert.equal(spec.body.paths['/v1/ai/identify'].post.security[0].bearer.length, 0);
});

test('CORS is only granted to the app\'s own origins', async () => {
  const own = await fetch(`${h.url}/healthz`, { headers: { origin: 'tauri://localhost' } });
  assert.equal(own.headers.get('access-control-allow-origin'), 'tauri://localhost');
  const foreign = await fetch(`${h.url}/healthz`, { headers: { origin: 'https://evil.example' } });
  assert.equal(foreign.headers.get('access-control-allow-origin'), null);
});

/** Revoking a key by pasting it, including a key no device has used yet. Only the licence id is ever kept. */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startHarness, type Harness } from './helpers.ts';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
const activate = (licenceKey: string, name: string) => h.call('POST', '/v1/licences/activate', {
  body: { licenceKey, deviceHash: crypto.createHash('sha256').update(name).digest('hex'), platform: 'windows', appVersion: '26.11.2' },
});
const revokeByKey = (licenceKey: string, token = h.adminToken) => h.call('POST', '/v1/admin/licences/revoke-by-key', { token, body: { licenceKey } });

test('a key revoked before anyone used it is refused at activation with a plain message', async () => {
  // Issued offline, like tools/licence/issue.mjs: the server has never seen it.
  const { licenceKey } = (await h.call('POST', '/v1/admin/licences/issue', { token: h.adminToken, body: { plan: 'paid' } })).body;
  const unseen = `KESTREL1.${Buffer.from(JSON.stringify({ v: 1, plan: 'paid', id: 'never-seen-1', issuedAt: h.clock.now })).toString('base64url')}`;
  const offlineKey = `${unseen}.${crypto.sign(null, Buffer.from(unseen.split('.')[1], 'base64url'), (h.app.config as { licencePrivateKey: crypto.KeyObject }).licencePrivateKey).toString('base64url')}`;
  assert.equal(await h.app.store.getLicence('never-seen-1'), undefined);

  const revoked = await revokeByKey(offlineKey);
  assert.equal(revoked.status, 200);
  assert.deepEqual(revoked.body, { licenceId: 'never-seen-1', revoked: true, wasKnown: false });
  const record = await h.app.store.getLicence('never-seen-1');
  assert.equal(record?.status, 'revoked');
  assert.equal(record?.note, 'Revoked before first use');

  const refused = await activate(offlineKey, 'stolen-laptop');
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error.code, 'LICENCE_NOT_ACTIVE');
  assert.match(refused.body.error.message, /no longer active.*local work is unaffected/);

  // A key already in use is revoked the same way.
  assert.equal((await activate(licenceKey, 'mac')).status, 200);
  assert.equal((await revokeByKey(licenceKey)).body.wasKnown, true);
  assert.equal((await activate(licenceKey, 'mac')).status, 403);
});

test('the key itself is never stored or logged; forged keys and non-admins are refused and audited', async () => {
  const { licenceKey } = (await h.call('POST', '/v1/admin/licences/issue', { token: h.adminToken, body: { plan: 'paid' } })).body;
  assert.equal((await revokeByKey(`${licenceKey.slice(0, -4)}AAAA`)).status, 400, 'a forged or mistyped key changes nothing');
  assert.equal((await revokeByKey('not-a-key-at-all-1234')).status, 400);
  assert.equal((await revokeByKey(licenceKey, h.user.token)).status, 403);
  assert.equal((await revokeByKey(licenceKey)).status, 200);

  const audit = await h.app.store.listAudit(500);
  assert.ok(audit.some((e) => e.action === 'licence.revoke' && e.outcome === 'denied' && e.actor === h.user.accountId));
  assert.ok(audit.some((e) => e.action === 'licence.revoke' && e.outcome === 'allowed' && e.detail.endsWith('by key')));
  const signature = licenceKey.split('.')[2];
  assert.ok(audit.every((e) => !e.detail.includes(signature) && !e.detail.includes('KESTREL1')), 'no key in the audit log');
  const listed = (await h.call('GET', '/v1/admin/licensees', { token: h.adminToken })).body;
  assert.ok(!JSON.stringify(listed).includes('KESTREL1'), 'no key in what the admin page receives');
});

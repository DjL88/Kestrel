import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startHarness } from './helpers.ts';

const device = (name: string) => crypto.createHash('sha256').update(name).digest('hex');

test('a key used before signing up attaches to the new account once, with its devices; never from another account', async () => {
  const h = await startHarness();
  try {
    // Used with no account: activated on a laptop.
    const issued = await h.call('POST', '/v1/admin/licences/issue', { token: h.adminToken, body: { plan: 'paid', maxDevices: 3 } });
    assert.equal(issued.status, 200, JSON.stringify(issued.body));
    const key = issued.body.licenceKey as string;
    assert.equal((await h.call('POST', '/v1/licences/activate', { body: { licenceKey: key, deviceHash: device('laptop'), platform: 'windows', appVersion: '26.11.2' } })).status, 200);

    // Then the person signs up and the app attaches the key.
    const ann = await h.app.createAccount('ann@example.test', 'a-long-password-123', 'user');
    const annToken = (await h.app.issueSession(ann, 'user')).accessToken;
    const attach = (token: string, licenceKey = key) => h.call('POST', '/v1/me/licence/attach', { token, body: { licenceKey } });
    let r = await attach(annToken);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.attached, r.body.already], [true, false]);
    r = await attach(annToken);
    assert.deepEqual([r.body.attached, r.body.already], [false, true], 'idempotent');
    const licences = await h.app.store.listLicencesForAccount(ann);
    assert.equal(licences.length, 1);
    assert.equal(licences[0]!.plan, 'paid');
    // The laptop activated before sign-up is now one of the account's devices.
    const devices = await h.call('POST', '/v1/me/devices', { token: annToken, body: { deviceHash: device('laptop') } });
    assert.equal(devices.status, 200, JSON.stringify(devices.body));
    assert.deepEqual(devices.body.devices.map((d: any) => [d.platform, d.thisDevice]), [['windows', true]]);

    // Someone else cannot take it: that is an account merge, proved from both sides.
    const bob = await h.app.createAccount('bob@example.test', 'a-long-password-123', 'user');
    r = await attach((await h.app.issueSession(bob, 'user')).accessToken);
    assert.equal(r.status, 409); assert.equal(r.body.error.code, 'LICENCE_ON_OTHER_ACCOUNT');
    assert.equal((await h.app.store.listLicencesForAccount(bob)).length, 0);

    // A key never activated anywhere is attached too; a forged one is refused; signing in is required.
    const fresh = await h.call('POST', '/v1/admin/licences/issue', { token: h.adminToken, body: { plan: 'paid', maxDevices: 2 } });
    assert.equal((await attach(annToken, fresh.body.licenceKey)).body.attached, true);
    assert.equal((await h.app.store.listLicencesForAccount(ann)).length, 2);
    assert.equal((await attach(annToken, `${key.slice(0, -4)}AAAA`)).status, 400);
    assert.equal((await h.call('POST', '/v1/me/licence/attach', { body: { licenceKey: key } })).status, 401);
    const audit = (await h.app.store.listAudit(100)).filter((e) => e.action === 'licence.attach');
    assert.ok(audit.some((e) => e.outcome === 'denied' && e.detail.endsWith('other')));
  } finally { await h.close(); }
});

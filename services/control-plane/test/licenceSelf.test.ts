/** What a key holder can see and do from the app: the licence's status and devices, and freeing a slot. */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startHarness, type Harness } from './helpers.ts';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
const device = (name: string) => crypto.createHash('sha256').update(name).digest('hex');

test('a key holder sees status and devices, frees a slot, and nobody else can', async () => {
  const issued = await h.call('POST', '/v1/admin/licences/issue', { token: h.adminToken, body: { plan: 'paid', maxDevices: 2 } });
  const key = issued.body.licenceKey;
  const status = (deviceHash: string) => h.call('POST', '/v1/licences/status', { body: { licenceKey: key, deviceHash } });
  assert.deepEqual((await status(device('mac'))).body.devices, []);
  for (const [name, platform] of [['mac', 'macos'], ['pc', 'windows']] as const) {
    assert.equal((await h.call('POST', '/v1/licences/activate', { body: { licenceKey: key, deviceHash: device(name), platform, appVersion: '26.11.2' } })).status, 200);
  }
  const seen = await status(device('mac'));
  assert.equal(seen.body.status, 'active');
  assert.equal(seen.body.maxDevices, 2);
  assert.deepEqual(seen.body.devices.map((d: { platform: string; thisDevice: boolean }) => [d.platform, d.thisDevice]).sort(), [['macos', true], ['windows', false]]);
  assert.equal(JSON.stringify(seen.body).includes(device('pc')), false, 'other devices\' hashes are never returned');

  const pc = seen.body.devices.find((d: { platform: string }) => d.platform === 'windows');
  const otherKey = (await h.call('POST', '/v1/admin/licences/issue', { token: h.adminToken, body: { plan: 'paid' } })).body.licenceKey;
  assert.equal((await h.call('POST', '/v1/licences/deactivate', { body: { licenceKey: otherKey, activationId: pc.activationId } })).status, 404, 'another key cannot free this licence\'s devices');
  assert.equal((await h.call('POST', '/v1/licences/deactivate', { body: { licenceKey: `${key.slice(0, -4)}AAAA`, activationId: pc.activationId } })).status, 400);
  assert.equal((await h.call('POST', '/v1/licences/deactivate', { body: { licenceKey: key, activationId: pc.activationId } })).status, 200);
  assert.equal((await status(device('mac'))).body.devices.length, 1);

  assert.equal((await h.call('POST', `/v1/admin/licences/${issued.body.licenceId}/revoke`, { token: h.adminToken })).status, 200);
  assert.equal((await status(device('mac'))).body.status, 'revoked');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { newLicence } from '../src/store.ts';
import { startHarness } from './helpers.ts';

test('a monthly account grant cannot outlive its paid-through date', async () => {
  const harness = await startHarness(null);
  try {
    const accountId = await harness.app.createAccount('storage@example.test', 'test-password-with-length', 'user');
    const token = (await harness.app.issueSession(accountId, 'user')).accessToken;
    const validUntilMs = harness.clock.now + 4 * 86_400_000;
    await harness.app.store.insertLicence(newLicence('monthly-storage-test', 'subscriber', harness.clock.now, { accountId, validUntilMs }));
    const response = await harness.call('POST', '/v1/me/activate', {
      token, body: { deviceHash: 'b'.repeat(64), platform: 'web', appVersion: '1.0.0' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.grant.payload.offlineUntilMs, validUntilMs);
  } finally {
    await harness.close();
  }
});

test('a one-off purchase gets an owned grant; a gift or a time-limited licence does not', async () => {
  const harness = await startHarness(null);
  try {
    const activate = async (email: string, extra: Parameters<typeof newLicence>[3]) => {
      const accountId = await harness.app.createAccount(email, 'test-password-with-length', 'user');
      const token = (await harness.app.issueSession(accountId, 'user')).accessToken;
      await harness.app.store.insertLicence(newLicence(`lic_${email.slice(0, 6)}_test`, 'paid', harness.clock.now, { accountId, ...extra }));
      const response = await harness.call('POST', '/v1/me/activate', { token, body: { deviceHash: 'c'.repeat(64), platform: 'macos', appVersion: '1.0.0' } });
      assert.equal(response.status, 200);
      return response.body.grant.payload.flags?.['licence.owned'];
    };
    assert.deepEqual(await activate('bought@example.test', { paid: true, source: 'purchase' }), { on: true });
    assert.equal(await activate('gifted@example.test', { paid: false, source: 'gift' }), undefined);
    assert.equal(await activate('timed1@example.test', { paid: true, source: 'purchase', validUntilMs: harness.clock.now + 86_400_000 }), undefined);
  } finally {
    await harness.close();
  }
});

test('signing in hands a buyer their own key for the version bought; a gift gets none', async () => {
  const harness = await startHarness(null);
  try {
    const { verifyLicence } = await import('../../../src/core/licence.ts');
    const signIn = async (email: string, extra: Parameters<typeof newLicence>[3]) => {
      const accountId = await harness.app.createAccount(email, 'test-password-with-length', 'user');
      const token = (await harness.app.issueSession(accountId, 'user')).accessToken;
      await harness.app.store.insertLicence(newLicence(`lic_${email.slice(0, 6)}_key`, 'paid', harness.clock.now, { accountId, ...extra }));
      return (await harness.call('POST', '/v1/me/activate', { token, body: { deviceHash: 'd'.repeat(64), platform: 'windows', appVersion: '1.0.0' } })).body;
    };
    const bought = await signIn('keybuy@example.test', { paid: true, source: 'purchase', majorVersion: 1 });
    const check = await verifyLicence(bought.licenceKey, harness.app.config.licencePublicKey, null);
    assert.ok(check.ok);
    if (check.ok) { assert.equal(check.details.id, 'lic_keybuy_key'); assert.equal(check.details.major, 1); }
    // The key names the same licence: the same device slot, refund and revoke.
    const viaKey = await harness.call('POST', '/v1/licences/activate', { body: { licenceKey: bought.licenceKey, deviceHash: 'd'.repeat(64), platform: 'windows', appVersion: '1.0.0' } });
    assert.equal(viaKey.status, 200);
    assert.equal(viaKey.body.activationId, bought.activationId);
    assert.deepEqual(viaKey.body.grant.payload.flags?.['licence.owned'], { on: true });
    assert.equal((await signIn('keygif@example.test', { paid: false, source: 'gift' })).licenceKey, undefined);
  } finally {
    await harness.close();
  }
});

test('a device swap: when every slot is taken, a device unused for 30 days is freed; a recently used one is not', async () => {
  const harness = await startHarness(null);
  try {
    const accountId = await harness.app.createAccount('swapper@example.test', 'test-password-with-length', 'user');
    await harness.app.store.insertLicence(newLicence('lic_swap_test', 'paid', harness.clock.now, { accountId, paid: true, source: 'purchase', maxDevices: 2 }));
    const activate = async (hash: string) => harness.call('POST', '/v1/me/activate', { token: (await harness.app.issueSession(accountId, 'user')).accessToken, body: { deviceHash: hash.repeat(64), platform: 'ios', appVersion: '1.0.0' } });
    assert.equal((await activate('1')).status, 200);
    harness.clock.now += 20 * 86_400_000;
    assert.equal((await activate('2')).status, 200);
    harness.clock.now += 5 * 86_400_000;
    // Device 1 was last used 25 days ago: still counts.
    assert.equal((await activate('3')).status, 409);
    harness.clock.now += 6 * 86_400_000;
    // Now 31 days: the old phone is freed and the new one takes its slot.
    assert.equal((await activate('3')).status, 200);
    const devices = await harness.app.store.listActivationsForLicence('lic_swap_test');
    assert.deepEqual(devices.map((d) => d.deviceHash[0]).sort(), ['2', '3']);
  } finally {
    await harness.close();
  }
});

test('freeing devices by hand: 3 a year, kind words after that, and support can reset it', async () => {
  const harness = await startHarness(null);
  try {
    const accountId = await harness.app.createAccount('mover@example.test', 'test-password-with-length', 'user');
    await harness.app.store.insertLicence(newLicence('lic_move_test', 'paid', harness.clock.now, { accountId, paid: true, source: 'purchase', maxDevices: 5 }));
    const call = async (path: string, hash: string, extra: object = {}) => harness.call('POST', path, {
      token: (await harness.app.issueSession(accountId, 'user')).accessToken, body: { deviceHash: hash.repeat(64), ...extra },
    });
    const add = (hash: string) => call('/v1/me/activate', hash, { platform: 'macos', appVersion: '1.0.0' });
    assert.equal((await add('a')).status, 200);
    const free = async () => {
      const other = await add('b');
      return call('/v1/me/devices/deactivate', 'a', { activationId: other.body.activationId });
    };
    for (let i = 0; i < 3; i += 1) assert.equal((await free()).status, 200);
    const refused = await free();
    assert.equal(refused.status, 429);
    assert.equal(refused.body.error.code, 'RELEASE_LIMIT');
    assert.match(refused.body.error.message, /contact support/);
    const reset = await harness.call('POST', '/v1/admin/licences/lic_move_test/releases/reset', { token: harness.adminToken });
    assert.equal(reset.status, 200);
    assert.equal((await free()).status, 200);
    // A year on, the allowance is back by itself.
    harness.clock.now += 366 * 86_400_000;
    for (let i = 0; i < 3; i += 1) assert.equal((await free()).status, 200);
  } finally {
    await harness.close();
  }
});

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

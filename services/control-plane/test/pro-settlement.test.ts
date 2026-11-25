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

import assert from 'node:assert/strict';
import test from 'node:test';
import { OFFLINE_ACCOUNT, storageRegionFor } from './cloudInterfaces.ts';

test('countries map to an explicit region, and unknown ones to none', () => {
  assert.equal(storageRegionFor('GB'), 'uk');
  assert.equal(storageRegionFor(' gb '), 'uk');
  assert.equal(storageRegionFor('FR'), 'eu');
  assert.equal(storageRegionFor('US'), 'us');
  assert.equal(storageRegionFor('JP'), null);
  assert.equal(storageRegionFor(''), null);
});

test('the offline account never reaches out and can always sign out', async () => {
  await assert.rejects(OFFLINE_ACCOUNT.auth.signIn('google'), /not available/);
  await assert.rejects(OFFLINE_ACCOUNT.sync.usage({ accountId: 'x', provider: 'google', expiresAtMs: 0 }), /not available/);
  await assert.rejects(OFFLINE_ACCOUNT.auth.signInWithEmail('a@b.c', 'x'), /not available/);
  await OFFLINE_ACCOUNT.auth.signOut();
  assert.deepEqual(await OFFLINE_ACCOUNT.licence.devices({ accountId: 'x', provider: 'google', expiresAtMs: 0 }), []);
});

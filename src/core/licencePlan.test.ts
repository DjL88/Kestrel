import test from 'node:test';
import assert from 'node:assert/strict';
import { licencePlan } from './licencePlan';

// Owner report, 25 Nov: Settings → Account showed only "Check Pro online", with no standing status. The plan line is
// read from the licence store's state, so it is right before any check is made.
test('Pro through an account, with its offline date', () => {
  const plan = licencePlan({ status: 'account', access: { pro: true }, standing: { kind: 'active', grant: { offlineUntilMs: 1_800_000_000_000 } } });
  assert.deepEqual(plan, { kind: 'pro-account', offlineUntilMs: 1_800_000_000_000 });
});

test('Pro through a licence key', () => {
  assert.deepEqual(licencePlan({ status: 'valid', access: { pro: true } }), { kind: 'pro-key' });
});

test('anything without verified Pro access is Free, never Pro', () => {
  assert.deepEqual(licencePlan({ status: 'none' }), { kind: 'free' });
  assert.deepEqual(licencePlan({ status: 'invalid' }), { kind: 'free' });
  assert.deepEqual(licencePlan({ status: 'valid', access: { pro: false } }), { kind: 'free' });
  assert.deepEqual(licencePlan({ status: 'account', access: { pro: false }, standing: { kind: 'active', grant: { offlineUntilMs: 1 } } }), { kind: 'free' });
});

test('while the stored licence is still being read it says so', () => {
  assert.deepEqual(licencePlan({ status: 'checking' }), { kind: 'checking' });
});
